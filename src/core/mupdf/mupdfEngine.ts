// core/mupdf/mupdfEngine.ts
//
// 基于 Artifex 官方 MuPDF.js (WebAssembly) 的编辑引擎。detect 用
// mupdf 的 `toStructuredText` 抽取结构化文本;writeTextBlock 不再走
// `applyRedactions` 路径(在中文 CID 字体 PDF 上不可靠 —— FreeType
// 找不到字体描述符时以 identity encoding 跳过字符,见用户日志:
// `warning: non-embedded font using identity encoding: SourceHan-*`),
// 而是**用 mupdf 给出字符级 quad + pdf-lib 画白底覆盖 + pdf-lib
// 重画新字**。视觉效果同"字节级 in-place 改写"。
import type {
  DetectTextBlocksOptions,
  EngineInterface,
  FormField,
  ParseFormFieldsOptions,
  TextBlock,
  WriteFormFieldsOptions,
  WriteFormFieldsResult,
  WriteTextBlockOptions,
  WriteTextBlockResult,
} from '../engine/types';
import { pdfLibFallbackEngine as pdfLibFallback } from '../engine/pdfLibFallback';
import { loadMupdf, type MupdfNs } from './loader';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { hexToRgb, pickStandardFont } from '../writer/helpers';

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

// ---------- CJK 字体加载 -----------------------------------------------------
//
// pdf-lib 的 14 个 Standard Fonts 仅 WinAnsi(ASCII / 西欧),不覆盖
// 中日韩。中文场景下用 @pdf-lib/fontkit 嵌入 OTF/TTF。
//
// 字体首次拉取后缓存在模块级变量,后续 commit 不再下载。CDN 源:
//   * jsdelivr / GitHub 的 Adobe Source Han Sans CN(OFL,完整 GB18030
//     简体 + 常见繁体)
const CJK_FONT_URLS = [
  'https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@release/SubsetOTF/CN/SourceHanSansCN-Regular.otf',
];
let cjkFontBytes: Uint8Array | null = null;
let cjkFontPending: Promise<Uint8Array | null> | null = null;

/** 允许外部(测试或运行时)塞入 CJK 字体字节以跳过 CDN 拉取。 */
export function setCjkFontBytes(bytes: Uint8Array): void {
  cjkFontBytes = bytes;
}

async function loadCjkFontBytes(): Promise<Uint8Array | null> {
  if (cjkFontBytes) return cjkFontBytes;
  if (cjkFontPending) return cjkFontPending;
  cjkFontPending = (async () => {
    for (const url of CJK_FONT_URLS) {
      try {
        // eslint-disable-next-line no-console
        console.log('[mupdf] 拉取 CJK 字体: %s', url);
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const ab = await resp.arrayBuffer();
        cjkFontBytes = new Uint8Array(ab);
        // eslint-disable-next-line no-console
        console.log(
          '[mupdf] CJK 字体加载完成 (%d KB)',
          Math.round(ab.byteLength / 1024)
        );
        return cjkFontBytes;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[mupdf] CJK 字体源失败,尝试下一个:', err);
      }
    }
    return null;
  })().finally(() => {
    cjkFontPending = null;
  });
  return cjkFontPending;
}

function containsNonAscii(s: string): boolean {
  for (const ch of s) {
    if ((ch.codePointAt(0) ?? 0) > 0x7e) return true;
  }
  return false;
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

// ---------- collectWhiteoutRectsWithMupdf ----------------------------------
//
// mupdf 在文档没装好嵌入字体时常以 identity encoding 渲染字符,
// 但 stext + walker 给出的字符 quad 仍然是按 PDF 内容流实际码位
// 算出的几何边界(坐标跟 unicode 字符是对得上的)。所以我们不再
// 信任 mupdf `applyRedactions` 的文本匹配,直接收集字符级 quad
// 列表给 pdf-lib 去覆盖。
function collectWhiteoutRectsWithMupdf(
  mupdf: MupdfNs,
  bytes: Uint8Array,
  pageIndex: number,
  bbox: { x: number; y: number; w: number; h: number }
): Array<{ x: number; y: number; w: number; h: number }> {
  const buf = new Uint8Array(bytes);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  let out: Array<{ x: number; y: number; w: number; h: number }> = [];
  try {
    const pdfDoc = doc.asPDF();
    if (!pdfDoc) return out;
    const page = pdfDoc.loadPage(pageIndex) as import('mupdf').PDFPage;
    try {
      const expandX = 0.05;
      const expandY = 0.25;
      const xMin = bbox.x - bbox.w * expandX;
      const xMax = bbox.x + bbox.w + bbox.w * expandX;
      const yMin = bbox.y - bbox.h * expandY;
      const yMax = bbox.y + bbox.h + bbox.h * expandY;

      const stext = page.toStructuredText('preserve-spans');
      const charHits: typeof out = [];
      const walker: Record<string, unknown> = {
        beginLine: function () {
          /* no-op */
        },
        endLine: function () {
          /* no-op */
        },
        beginTextBlock: function () {
          /* no-op */
        },
        endTextBlock: function () {
          /* no-op */
        },
        beginStruct: function () {
          /* no-op */
        },
        endStruct: function () {
          /* no-op */
        },
        onChar: function (
          _utf: string,
          _origin: number[],
          _font: unknown,
          _size: number,
          quad: number[],
          _argb: number,
          _flags: number
        ) {
          if (quad.length < 8) return;
          let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
          for (let i = 0; i < 8; i += 2) {
            const xv = quad[i];
            const yv = quad[i + 1];
            if (xv < minX) minX = xv;
            if (xv > maxX) maxX = xv;
            if (yv < minY) minY = yv;
            if (yv > maxY) maxY = yv;
          }
          const cw = maxX - minX;
          const ch = maxY - minY;
          if (
            minX + cw >= xMin &&
            minX <= xMax &&
            minY + ch >= yMin &&
            minY <= yMax
          ) {
            charHits.push({ x: minX, y: minY, w: cw, h: ch });
          }
        },
        onImageBlock: function () {
          /* no-op */
        },
        onVector: function () {
          /* no-op */
        },
      };
      (stext as unknown as { walk: (w: unknown) => void }).walk(walker);
      stext.destroy();
      out = charHits;
    } finally {
      page.destroy();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[mupdf] 字符 quad 收集失败:', err);
  } finally {
    doc.destroy();
  }
  if (out.length === 0) {
    // walker 完全没拿到字符 —— 用整个 block.bbox 兜底,避免没擦到。
    out = [{ x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }];
  }
  return out;
}

// ---------- applyWhiteoutAndRedrawWithPdfLib ------------------------------
//
// 用 pdf-lib 完成 mupdf 不能可靠完成的"删字+画字"两步:
//   (a) 对每个 char quad 画白色矩形,完全覆盖原字
//   (b) 在 block baseline 处用 fontkit + Source Han Sans CN 画新字
async function applyWhiteoutAndRedrawWithPdfLib(
  pdfBytes: Uint8Array,
  pageIndex: number,
  bbox: { x: number; y: number; w: number; h: number },
  whiteoutRects: Array<{ x: number; y: number; w: number; h: number }>,
  newText: string,
  fontSize: number,
  color: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  if (pageIndex < 0 || pageIndex >= pages.length) return pdfBytes;
  const page = pages[pageIndex];
  const pageHeight = page.getHeight();
  const { r, g, b } = hexToRgb(color || '#000000');
  const white = rgb(1, 1, 1);

  // (a) 白底覆盖每个字符 quad。stext 给出 y-down 顶左坐标系,
  // pdf-lib drawRectangle 用 y-up 底左。
  for (const r0 of whiteoutRects) {
    const padY = Math.max(1, r0.h * 0.1);
    const padX = 0.5;
    const yPdf = pageHeight - r0.y - r0.h - padY;
    page.drawRectangle({
      x: r0.x - padX,
      y: yPdf,
      width: r0.w + 2 * padX,
      height: r0.h + 2 * padY,
      color: white,
      borderWidth: 0,
      opacity: 1,
    });
  }

  // (b) 新字符绘制
  if (!newText) return doc.save();
  const needsCjk = containsNonAscii(newText);
  let font: Awaited<ReturnType<typeof doc.embedFont>>;
  if (needsCjk) {
    doc.registerFontkit(fontkit);
    const cjkBytes = await loadCjkFontBytes();
    if (!cjkBytes) {
      const fallback = await doc.embedFont(
        pickStandardFont('Helvetica', false, false)
      );
      let safe = '';
      for (const ch of newText) {
        safe += (ch.codePointAt(0) ?? 0) > 0x7e ? '?' : ch;
      }
      page.drawText(safe, {
        x: bbox.x,
        y: pageHeight - bbox.y - fontSize,
        size: fontSize,
        font: fallback,
        color: rgb(r, g, b),
      });
      return doc.save();
    }
    font = await doc.embedFont(cjkBytes, { subset: true });
  } else {
    font = await doc.embedFont(pickStandardFont('Helvetica', false, false));
  }
  page.drawText(newText, {
    x: bbox.x,
    y: pageHeight - bbox.y - fontSize,
    size: fontSize,
    font,
    color: rgb(r, g, b),
  });
  return doc.save();
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

  async writeTextBlock({
    pdfBytes,
    pageIndex,
    block,
    newText,
  }: WriteTextBlockOptions): Promise<WriteTextBlockResult> {
    const mupdf = await loadMupdf();
    // 收集字符 quad → pdf-lib 白底覆盖 → pdf-lib 画新字
    const quads = collectWhiteoutRectsWithMupdf(
      mupdf,
      new Uint8Array(pdfBytes),
      pageIndex,
      block.bbox
    );
    const result = await applyWhiteoutAndRedrawWithPdfLib(
      new Uint8Array(pdfBytes),
      pageIndex,
      block.bbox,
      quads,
      newText,
      block.fontSize,
      block.color
    );
    return { bytes: result, source: 'mupdf' };
  },

  async parseFormFields({
    pdfBytes,
  }: ParseFormFieldsOptions): Promise<FormField[]> {
    return pdfLibFallback.parseFormFields({ pdfBytes });
  },

  async writeFormFields(
    options: WriteFormFieldsOptions
  ): Promise<WriteFormFieldsResult> {
    return pdfLibFallback.writeFormFields(options);
  },
};

export { loadMupdf };
