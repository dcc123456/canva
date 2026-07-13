// engine/pdfLibFallback.ts
//
// Implements `EngineInterface` using only the packages already in
// `package.json`:
//
//   * `pdfjs-dist` provides `getTextContent` (yields per-glyph TextItems
//     with a transform matrix in PDF user-space units) and
//     `getFieldObjects` (AcroForm enumeration).
//
// 重构后只保留 detect/parse 只读能力。文本编辑和表单写入不再走引擎 --
// 编辑只改 overlay,导出时用 pdf-lib 统一应用。
import { loadDocument, pdfjsLib } from '../pdf/loader';
import type {
  DetectTextBlocksOptions,
  EngineInterface,
  FormField,
  ParseFormFieldsOptions,
  TextBlock,
} from './types';
import type { Rect } from '../types';

interface PdfJsTextItem {
  str: string;
  dir: string;
  transform: Array<number>;
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

const Y_TOLERANCE = 2; // pt; small enough to keep separate lines apart

function isTextItem(it: unknown): it is PdfJsTextItem {
  return (
    !!it &&
    typeof it === 'object' &&
    'str' in (it as object) &&
    'transform' in (it as object)
  );
}

function clusterIntoLines(
  items: PdfJsTextItem[]
): Array<{ y: number; items: PdfJsTextItem[] }> {
  // Sort by baseline y (transform[5]) desc - pdfjs y is bottom-up.
  const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5]);
  const lines: Array<{ y: number; items: PdfJsTextItem[] }> = [];
  for (const it of sorted) {
    const y = it.transform[5];
    const line = lines.find((l) => Math.abs(l.y - y) <= Y_TOLERANCE);
    if (line) {
      line.items.push(it);
    } else {
      lines.push({ y, items: [it] });
    }
  }
  return lines;
}

function rectOfLine(
  pageHeight: number,
  lineItems: PdfJsTextItem[]
): { rect: Rect; fontSize: number; fontName: string } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let fontSize = 0;
  let fontName = 'g_d0_f1';
  for (const it of lineItems) {
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.max(it.height || 0, 0.1);
    if (x < minX) minX = x;
    if (x + it.width > maxX) maxX = x + it.width;
    if (y < minY) minY = y;
    if (y + h > maxY) maxY = y + h;
    const scaleY = Math.hypot(it.transform[2], it.transform[3]) || h;
    if (scaleY > fontSize) fontSize = scaleY;
    if (it.fontName) fontName = it.fontName;
  }
  // pdfjs is y-up from the bottom; our store is y-down from the top.
  const top = pageHeight - maxY;
  const height = Math.max(maxY - minY, fontSize || 1);
  return {
    rect: { x: minX, y: top, w: Math.max(maxX - minX, 1), h: height },
    fontSize: fontSize || height,
    fontName,
  };
}

async function detectTextBlocksImpl(
  opts: DetectTextBlocksOptions
): Promise<TextBlock[]> {
  const doc = await loadDocument(opts.pdfBytes);
  const page = await doc.getPage(opts.pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = (tc.items as unknown[]).filter(isTextItem);
  const lines = clusterIntoLines(items);
  // 每行的完整信息(baseline + bbox + fontSize + text)
  interface LineInfo {
    baseline: number;
    rect: Rect;
    fontSize: number;
    fontName: string;
    text: string;
  }
  const lineInfos: LineInfo[] = [];
  for (const line of lines) {
    const { rect, fontSize, fontName } = rectOfLine(viewport.height, line.items);
    const text = line.items
      .sort((a, b) => a.transform[4] - b.transform[4])
      .map((it) => it.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    lineInfos.push({
      baseline: line.y,
      rect,
      fontSize,
      fontName,
      text,
    });
  }
  // 按段落聚类:相邻行(x 范围重叠 + 行间距合理 + 字号相近)合并
  interface Paragraph { lines: LineInfo[] }
  const paragraphs: Paragraph[] = [];
  for (const li of lineInfos) {
    const last = paragraphs[paragraphs.length - 1];
    if (last) {
      const prev = last.lines[last.lines.length - 1];
      const baselineDiff = li.baseline - prev.baseline;
      const minSize = Math.min(prev.fontSize, li.fontSize);
      const maxSize = Math.max(prev.fontSize, li.fontSize);
      const xOverlap = li.rect.x < prev.rect.x + prev.rect.w && li.rect.x + li.rect.w > prev.rect.x;
      const spacingOk = baselineDiff >= minSize * 0.8 && baselineDiff <= maxSize * 3.0;
      const sizeOk = maxSize / minSize <= 1.3;
      if (xOverlap && spacingOk && sizeOk) {
        last.lines.push(li);
        continue;
      }
    }
    paragraphs.push({ lines: [li] });
  }
  const blocks: TextBlock[] = paragraphs.map((para, i) => {
    const text = para.lines.map((l) => l.text).join('\n').trim();
    const minX = Math.min(...para.lines.map((l) => l.rect.x));
    const minY = Math.min(...para.lines.map((l) => l.rect.y));
    const maxRight = Math.max(...para.lines.map((l) => l.rect.x + l.rect.w));
    const maxBottom = Math.max(...para.lines.map((l) => l.rect.y + l.rect.h));
    const head = para.lines[0];
    let lineHeight = 1.2;
    if (para.lines.length > 1) {
      const diffs: number[] = [];
      for (let j = 1; j < para.lines.length; j++) {
        diffs.push(para.lines[j].baseline - para.lines[j - 1].baseline);
      }
      const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      lineHeight = avgDiff / head.fontSize;
    }
    return {
      id: `tb-${opts.pageIndex}-${i}`,
      bbox: {
        x: minX,
        y: minY,
        w: Math.max(1, maxRight - minX),
        h: Math.max(1, maxBottom - minY),
      },
      text,
      font: head.fontName,
      fontSize: head.fontSize,
      color: '#000000',
      lineHeight: Math.max(0.5, Math.round(lineHeight * 100) / 100),
      bold: /bold/i.test(head.fontName),
      italic: /italic|oblique/i.test(head.fontName),
    } satisfies TextBlock;
  });
  page.cleanup();
  return blocks;
}

function mapFieldKind(
  type: string | undefined,
  hasOptions: boolean
): FormField['kind'] {
  const t = (type ?? '').toLowerCase();
  if (t === 'tx' || t === 'text') return 'text';
  if (t === 'ch') return hasOptions ? 'select' : 'text';
  if (t === 'sig') return 'signature';
  if (t === 'btn') return 'checkbox';
  if (t === 'radio') return 'radio';
  return 'text';
}

function normaliseValue(
  value: string | string[] | boolean | undefined,
  kind: FormField['kind']
): string | boolean {
  if (kind === 'checkbox' || typeof value === 'boolean') {
    return !!value;
  }
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}

async function parseFormFieldsImpl(
  opts: ParseFormFieldsOptions
): Promise<FormField[]> {
  const doc = await loadDocument(opts.pdfBytes);
  // AcroForm fields are document-level in pdfjs's view. We get them
  // once, then walk the pages to attribute each field to the page its
  // annotation rectangle lives on.
  const raw = await doc.getFieldObjects();
  const fields: FormField[] = [];
  if (!raw) return fields;
  // Cache per-page viewport for bbox -> pageIndex lookup.
  const viewportByPage: Array<{ width: number; height: number }> = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    viewportByPage.push({ width: vp.width, height: vp.height });
    page.cleanup();
  }
  for (const [name, arr] of Object.entries(raw)) {
    if (!Array.isArray(arr)) continue;
    arr.forEach((entry: unknown, idx: number) => {
      if (!entry || typeof entry !== 'object') return;
      const e = entry as {
        type?: string;
        value?: string | string[] | boolean;
        rect?: [number, number, number, number];
        options?: Array<[string, string]>;
        page?: number;
      };
      const rect = e.rect;
      if (!rect) return;
      // If pdfjs already gave us the page index, use it. Otherwise guess
      // by finding the page whose viewport rect contains the field's
      // bottom-left corner.
      let pageIndex = typeof e.page === 'number' ? e.page : 0;
      if (typeof e.page !== 'number') {
        for (let i = 0; i < viewportByPage.length; i += 1) {
          const vp = viewportByPage[i];
          if (rect[0] >= 0 && rect[0] <= vp.width) {
            pageIndex = i;
            break;
          }
        }
      }
      const vp = viewportByPage[pageIndex];
      const [x1, y1, x2, y2] = rect;
      const top = vp.height - y2;
      const bbox: Rect = {
        x: Math.min(x1, x2),
        y: top,
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
      };
      const kind = mapFieldKind(e.type, !!e.options);
      const value = normaliseValue(e.value, kind);
      fields.push({
        id: `ff-${pageIndex}-${name}-${idx}`,
        pageIndex,
        fieldName: name,
        kind,
        bbox,
        value,
        options: e.options?.map((o) => o[0] ?? o[1] ?? ''),
      });
    });
  }
  return fields;
}

export const pdfLibFallbackEngine: EngineInterface = {
  kind: 'pdflib-overlay',
  detectTextBlocks: detectTextBlocksImpl,
  parseFormFields: parseFormFieldsImpl,
};

void pdfjsLib;
