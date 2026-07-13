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
      }
      const atoms: AtomLine[] = [];
      for (const block of json.blocks) {
        if (block.type !== 'text' || !block.lines) continue;
        for (const line of block.lines) {
          // 清掉 mupdf 在 span 末尾插的 \n / 控制字符。
          const text = (line.text ?? '')
            .replace(/[\r\n\t\v\f]+/g, '')
            .trim();
          if (!text) continue;
          const baseline = (line.y ?? line.bbox.y + line.bbox.h) | 0;
          atoms.push({
            bbox: { ...line.bbox },
            text,
            baseline,
            font: line.font?.name ?? line.font?.family ?? 'embedded',
            size: line.font?.size || line.bbox.h || 12,
          });
        }
      }
      // 按 baseline 聚类:同行 span (baseline 差 < 字号/2) 拼到一起,
      // 组内按 x 排序,得到"一行一个 block"的语义。
      atoms.sort((a, b) => a.baseline - b.baseline || a.bbox.x - b.bbox.x);
      interface Cluster {
        baseline: number;
        lines: AtomLine[];
      }
      const clusters: Cluster[] = [];
      for (const atom of atoms) {
        const tol = Math.max(2, atom.size * 0.5);
        const last = clusters[clusters.length - 1];
        if (last && Math.abs(last.baseline - atom.baseline) <= tol) {
          last.lines.push(atom);
        } else {
          clusters.push({ baseline: atom.baseline, lines: [atom] });
        }
      }
      const blocks: TextBlock[] = [];
      clusters.forEach((cluster, idx) => {
        cluster.lines.sort((a, b) => a.bbox.x - b.bbox.x);
        const text = cluster.lines.map((l) => l.text).join('').trim();
        if (!text) return;
        const minX = Math.min(...cluster.lines.map((l) => l.bbox.x));
        const minY = Math.min(...cluster.lines.map((l) => l.bbox.y));
        const maxRight = Math.max(
          ...cluster.lines.map((l) => l.bbox.x + l.bbox.w)
        );
        const maxBottom = Math.max(
          ...cluster.lines.map((l) => l.bbox.y + l.bbox.h)
        );
        const head = cluster.lines[0];
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
