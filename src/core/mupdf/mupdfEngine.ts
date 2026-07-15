// core/mupdf/mupdfEngine.ts
//
// 基于 Artifex 官方 MuPDF.js (WebAssembly) 的检测引擎。
//
// 重构后只保留 detectTextBlocks(toStructuredText 抽取结构化文本)和
// parseFormFields(委托给 pdfLibFallback)。文本编辑不再在编辑时调
// 引擎 -- 编辑只改 overlay,导出时用 core/writer/textBlockEdits.ts
// 统一应用(字符级白底 + 重画)。
//
// CJK 字体加载已移至 core/writer/cjkFont.ts;
// 字符 quad 收集已移至 core/writer/textQuad.ts。
import type {
  DetectTextBlocksOptions,
  EngineInterface,
  FormField,
  ParseFormFieldsOptions,
  TextBlock,
} from '../engine/types';
import type { RichTextSegment } from '../types';
import { pdfLibFallbackEngine as pdfLibFallback } from '../engine/pdfLibFallback';
import { loadMupdf, type MupdfNs } from './loader';

// MuPDF 的 StructuredText JSON schema(`mupdf.d.ts` 里 `asJSON()` 返回
// string)。
interface MupdfStextJson {
  blocks: Array<{
    type: 'text' | 'image' | string;
    bbox: { x: number; y: number; w: number; h: number };
    lines?: Array<{
      wmode: number;
      bbox: { x: number; y: number; w: number; h: number };
      font: {
        name: string;
        family: string;
        weight: string;
        style: string;
        size: number;
      };
      x: number;
      y: number;
      text: string;
    }>;
  }>;
}

// ---------- detectTextBlocks ------------------------------------------------

function detectTextBlocksImpl(
  mupdf: MupdfNs,
  bytes: Uint8Array,
  pageIndex: number
): TextBlock[] {
  const buf = new Uint8Array(bytes);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  try {
    const page = doc.loadPage(pageIndex);
    let stext: ReturnType<typeof page.toStructuredText> | null = null;
    try {
      // 用 "preserve-spans" 保证 mupdf 不会把多个视觉行合并到一行;
      // 我们自行按 baseline-y 聚类,把同行 span 拼成"一行一个 block"。
      stext = page.toStructuredText('preserve-spans');
      const json = JSON.parse(stext.asJSON()) as MupdfStextJson;
      interface AtomLine {
        bbox: { x: number; y: number; w: number; h: number };
        text: string;
        baseline: number;
        font: string;
        size: number;
        bold: boolean;
        italic: boolean;
      }
      const atoms: AtomLine[] = [];
      for (const block of json.blocks) {
        if (block.type !== 'text' || !block.lines) continue;
        for (const line of block.lines) {
          // WYSIWYG: 保留普通空格和制表符(\t),只去掉换行/控制符。
          // \t 在 PDF 中是合法的行内空白,必须保留。
          const text = (line.text ?? '').replace(/[\r\n\v\f]+/g, '');
          if (text.length === 0) continue;
          const baseline = (line.y ?? line.bbox.y + line.bbox.h) | 0;
          const fi = line.font;
          const fName = (fi?.name ?? fi?.family ?? 'embedded');
          const fLower = fName.toLowerCase();
          const wLower = (fi?.weight ?? '').toLowerCase();
          const sLower = (fi?.style ?? '').toLowerCase();
          atoms.push({
            bbox: { ...line.bbox },
            text,
            baseline,
            font: fName,
            size: fi?.size || line.bbox.h || 12,
            bold: fLower.includes('bold') || wLower.includes('bold') || wLower === '700',
            italic: fLower.includes('italic') || fLower.includes('oblique') || sLower.includes('italic') || sLower.includes('oblique'),
          });
        }
      }
      // 按 baseline 聚类:同行 span (baseline 差 < 字号/2) 拼到一起。
      // 同行两个 atom 之间水平间距 > 平均字符宽度的 3 倍时拆分,
      // 阈值基于实际字符宽度而非写死的字号倍数。
      atoms.sort((a, b) => a.baseline - b.baseline || a.bbox.x - b.bbox.x);
      interface Line {
        baseline: number;
        atoms: AtomLine[];
        text: string;
        x: number;
        w: number;
        y: number;
        h: number;
        size: number;
        font: string;
        bold: boolean;
        italic: boolean;
        align?: 'left' | 'center' | 'right';
        isHeading?: boolean;
      }
      // 计算平均字符宽度:用所有 atom 的 text 长度 / bbox 宽度。
      function avgCharWidth(at: AtomLine): number {
        const charCount = [...(at.text || ' ')].length;
        return charCount > 0 ? at.bbox.w / charCount : at.size * 0.5;
      }

      const lines: Line[] = [];
      for (const atom of atoms) {
        const tol = Math.max(2, atom.size * 0.5);
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.baseline - atom.baseline) <= tol) {
          const lastAtom = last.atoms[last.atoms.length - 1];
          const gap = atom.bbox.x - (lastAtom.bbox.x + lastAtom.bbox.w);
          // 阈值 = 两个 atom 中较大的平均字符宽度 * 3
          const avgW = Math.max(avgCharWidth(lastAtom), avgCharWidth(atom));
          if (gap > avgW * 3) {
            // 间距超过 3 个字符宽度 -- 拆分为独立块。
            lines.push({
              baseline: atom.baseline,
              atoms: [atom],
              text: '',
              x: atom.bbox.x,
              w: atom.bbox.w,
              y: atom.bbox.y,
              h: atom.bbox.h,
              size: atom.size,
              font: atom.font,
              bold: atom.bold,
              italic: atom.italic,
            });
          } else {
            last.atoms.push(atom);
          }
        } else {
          lines.push({
            baseline: atom.baseline,
            atoms: [atom],
            text: '',
            x: atom.bbox.x,
            w: atom.bbox.w,
            y: atom.bbox.y,
            h: atom.bbox.h,
            size: atom.size,
            font: atom.font,
            bold: atom.bold,
            italic: atom.italic,
          });
        }
      }
      for (const line of lines) {
        line.atoms.sort((a, b) => a.bbox.x - b.bbox.x);
        // WYSIWYG: atoms 已包含 MuPDF span 自带的空格,直接拼接即可,
        // 不再 trim -- 保留行首/行尾真实空格。
        line.text = line.atoms.map((a) => a.text).join('');
        line.x = Math.min(...line.atoms.map((a) => a.bbox.x));
        const maxR = Math.max(...line.atoms.map((a) => a.bbox.x + a.bbox.w));
        line.w = maxR - line.x;
        line.y = Math.min(...line.atoms.map((a) => a.bbox.y));
        const maxB = Math.max(...line.atoms.map((a) => a.bbox.y + a.bbox.h));
        line.h = maxB - line.y;
        line.size = line.atoms[0].size;
        line.font = line.atoms[0].font;
        line.bold = line.atoms[0].bold;
        line.italic = line.atoms[0].italic;
      }
      // Compute page content area and median font size for alignment/heading detection.
      const allLefts = lines.map((l) => l.x);
      const allRights = lines.map((l) => l.x + l.w);
      const leftEdge = allLefts.length > 0 ? Math.min(...allLefts) : 0;
      const rightEdge = allRights.length > 0 ? Math.max(...allRights) : 0;
      const contentCenter = (leftEdge + rightEdge) / 2;
      const contentWidth = Math.max(1, rightEdge - leftEdge);
      const alignTol = contentWidth * 0.05;
      const sortedSizes = lines.map((l) => l.size).sort((a, b) => a - b);
      const medianSize = sortedSizes.length > 0
        ? sortedSizes[Math.floor(sortedSizes.length / 2)]
        : 12;

      // Detect alignment and heading status for each line.
      for (const line of lines) {
        const lineLeft = line.x;
        const lineRight = line.x + line.w;
        const lineCenter = line.x + line.w / 2;
        const isLeft = Math.abs(lineLeft - leftEdge) <= alignTol;
        const isRight = Math.abs(lineRight - rightEdge) <= alignTol;
        const isCenter = Math.abs(lineCenter - contentCenter) <= alignTol;
        if (isCenter && !isLeft && !isRight) {
          line.align = 'center';
        } else if (isRight && !isLeft) {
          line.align = 'right';
        } else {
          line.align = 'left';
        }
        // Heading: font size significantly larger than median.
        line.isHeading = line.size > medianSize * 1.5;
      }

      // 按段落聚类:多行字号/粗细/斜体一致 -> 同一段落。
      // 任何一个样式属性不同 -> 拆分为独立块。
      // 行间距阈值基于实际字符宽度(自适应)。
      interface Paragraph { lines: Line[] }
      const paragraphs: Paragraph[] = [];
      for (const line of lines) {
        if (!line.text) continue;
        const last = paragraphs[paragraphs.length - 1];
        if (last) {
          const prev = last.lines[last.lines.length - 1];
          const baselineDiff = line.baseline - prev.baseline;
          const minSize = Math.min(prev.size, line.size);
          const maxSize = Math.max(prev.size, line.size);
          const xOverlap = line.x < prev.x + prev.w && line.x + line.w > prev.x;
          // 行间距:0.8x ~ 2.0x 字号(正常行距 1.2-1.5x)。
          const spacingOk = baselineDiff >= minSize * 0.8 && baselineDiff <= maxSize * 2.0;
          // 字号一致(1.1x 以内视为相同)。
          const sizeOk = maxSize / minSize <= 1.1;
          // 粗细和斜体必须一致才合并。
          const styleOk = line.bold === prev.bold && line.italic === prev.italic;
          // 对齐方式必须一致。
          const alignOk = (line.align || 'left') === (prev.align || 'left');
          // 标题边界不跨越。
          const headingOk = !!line.isHeading === !!prev.isHeading;
          if (xOverlap && spacingOk && sizeOk && styleOk && alignOk && headingOk) {
            last.lines.push(line);
            continue;
          }
        }
        paragraphs.push({ lines: [line] });
      }
      const blocks: TextBlock[] = [];
      paragraphs.forEach((para, idx) => {
        // WYSIWYG: 保留段落首尾真实空格,不再 trim。
        // 每行已在上面用 `if (!text.trim()) continue` 过滤掉纯空白行,
        // 所以段落里至少有一行非空白文字。
        const text = para.lines.map((l) => l.text).join('\n');
        if (!text) return;
        const minX = Math.min(...para.lines.map((l) => l.x));
        const minY = Math.min(...para.lines.map((l) => l.y));
        const maxRight = Math.max(...para.lines.map((l) => l.x + l.w));
        const maxBottom = Math.max(...para.lines.map((l) => l.y + l.h));
        const head = para.lines[0];
        let lineHeight = 1.2;
        if (para.lines.length > 1) {
          const diffs: number[] = [];
          for (let i = 1; i < para.lines.length; i++) {
            diffs.push(para.lines[i].baseline - para.lines[i - 1].baseline);
          }
          const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
          lineHeight = avgDiff / head.size;
        }
        // Build per-atom segments to preserve style changes at the font-run
        // level. MuPDF's preserve-spans splits different fonts into separate
        // lines (atoms), so each atom has a single consistent font/bold/italic/size.
        // \n is only added between different baselines (actual line breaks),
        // not between atoms on the same visual line.
        const rawSegs: RichTextSegment[] = [];
        para.lines.forEach((line, li) => {
          if (li > 0) rawSegs.push({ text: '\n' });
          for (const atom of line.atoms) {
            const seg: RichTextSegment = { text: atom.text };
            if (atom.bold) seg.bold = true;
            if (atom.italic) seg.italic = true;
            if (atom.font) seg.fontFamily = atom.font;
            if (atom.size) seg.fontSize = Math.round(atom.size * 100) / 100;
            rawSegs.push(seg);
          }
        });
        // Merge adjacent segments with identical style to reduce fragmentation.
        const segs: RichTextSegment[] = [];
        for (const seg of rawSegs) {
          const last = segs[segs.length - 1];
          if (
            last &&
            !!last.bold === !!seg.bold &&
            !!last.italic === !!seg.italic &&
            (last.fontFamily || '') === (seg.fontFamily || '') &&
            (last.fontSize ?? 0) === (seg.fontSize ?? 0)
          ) {
            last.text += seg.text;
          } else {
            segs.push({ ...seg });
          }
        }

        // Use the first line's alignment for the whole block.
        const blockAlign = head.align || 'left';

        blocks.push({
          id: `tb-${pageIndex}-${idx}`,
          bbox: {
            x: minX,
            y: minY,
            w: Math.max(1, maxRight - minX),
            h: Math.max(1, maxBottom - minY),
          },
          text,
          font: head.font,
          fontSize: head.size,
          color: '#000000',
          lineHeight: Math.max(0.5, Math.round(lineHeight * 100) / 100),
          bold: head.bold,
          italic: head.italic,
          segments: segs,
          align: blockAlign,
        });
      });
      return blocks;
    } finally {
      stext?.destroy();
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}

// ---------- EngineInterface glue --------------------------------------------

export const mupdfEngine: EngineInterface = {
  kind: 'mupdf',

  async detectTextBlocks({
    pdfBytes,
    pageIndex,
  }: DetectTextBlocksOptions): Promise<TextBlock[]> {
    const mupdf = await loadMupdf();
    return detectTextBlocksImpl(mupdf, new Uint8Array(pdfBytes), pageIndex);
  },

  async parseFormFields({
    pdfBytes,
  }: ParseFormFieldsOptions): Promise<FormField[]> {
    return pdfLibFallback.parseFormFields({ pdfBytes });
  },
};

export { loadMupdf };
