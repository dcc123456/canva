// engine/pdfLibFallback.ts
//
// Implements `EngineInterface` using only the packages already in
// `package.json`:
//
//   * `pdfjs-dist` provides `getTextContent` (yields per-glyph TextItems
//     with a transform matrix in PDF user-space units — i.e. PDF points
//     relative to the page, but still in a 1× viewport) and
//     `getFieldObjects` (AcroForm enumeration).
//   * `pdf-lib` is used to: (a) white-out the original block area with a
//     `drawRectangle` and (b) write the new text with `drawText` at the
//     same baseline.
//
// We never modify the original PDF in place; we always produce a fresh
// `Uint8Array` and bubble it up so the document store can replace its
// `pdfBytes`.
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import { loadDocument, pdfjsLib } from '../pdf/loader';
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
  // Sort by baseline y (transform[5]) desc — pdfjs y is bottom-up.
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
  const blocks: TextBlock[] = lines
    .map((line, i) => {
      const { rect, fontSize, fontName } = rectOfLine(viewport.height, line.items);
      const text = line.items
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((it) => it.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return null;
      return {
        id: `tb-${opts.pageIndex}-${i}`,
        bbox: rect,
        text,
        font: fontName,
        fontSize,
        color: '#000000',
      } satisfies TextBlock;
    })
    .filter((b): b is TextBlock => !!b);
  page.cleanup();
  return blocks;
}

function pickFallbackFont(name: string): StandardFonts {
  const lower = name.toLowerCase();
  if (lower.includes('bold') && lower.includes('italic')) {
    return StandardFonts.HelveticaBoldOblique;
  }
  if (lower.includes('bold')) return StandardFonts.HelveticaBold;
  if (lower.includes('italic') || lower.includes('oblique')) {
    return StandardFonts.HelveticaOblique;
  }
  return StandardFonts.Helvetica;
}

async function writeTextBlockImpl(
  opts: WriteTextBlockOptions
): Promise<WriteTextBlockResult> {
  const src = await PDFDocument.load(opts.pdfBytes);
  const page = src.getPage(opts.pageIndex);
  const pageHeight = page.getHeight();
  const fontName = pickFallbackFont(opts.block.font);
  const font: PDFFont = await src.embedFont(fontName);
  // White-out the original area.
  page.drawRectangle({
    x: opts.block.bbox.x,
    y: pageHeight - opts.block.bbox.y - opts.block.bbox.h,
    width: opts.block.bbox.w,
    height: opts.block.bbox.h,
    color: rgb(1, 1, 1),
    opacity: 1,
  });
  const fontSize = Math.max(opts.block.fontSize, 6);
  // Anchor baseline near the bottom of the bbox.
  const baselineY = pageHeight - opts.block.bbox.y - fontSize;
  page.drawText(opts.newText, {
    x: opts.block.bbox.x,
    y: baselineY,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
    maxWidth: opts.block.bbox.w,
  });
  const bytes = await src.save();
  return { bytes, source: 'pdflib-overlay' };
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
  // Cache per-page viewport for bbox → pageIndex lookup.
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

async function writeFormFieldsImpl(
  opts: WriteFormFieldsOptions
): Promise<WriteFormFieldsResult> {
  const src = await PDFDocument.load(opts.pdfBytes);
  const form = src.getForm();
  for (const field of opts.values) {
    try {
      if (field.kind === 'checkbox') {
        const cb = form.getCheckBox(field.fieldName);
        cb.check();
      } else if (field.kind === 'radio' || field.kind === 'select') {
        // pdf-lib's Dropdown / OptionList are the safest match for `Ch`
        // (choice) fields; we use the dropdown variant.
        const dd = form.getDropdown(field.fieldName);
        const v = String(field.value);
        if (v) dd.select(v);
      } else {
        // text / signature both go through getTextField.
        const tf = form.getTextField(field.fieldName);
        const v = String(field.value);
        tf.setText(v);
      }
    } catch (err) {
      // Field name might not exist in the underlying PDF; ignore so the
      // rest of the form can still be written.
      console.warn(
        `[pdfLibFallback] failed to set form field "${field.fieldName}":`,
        err
      );
    }
  }
  const bytes = await src.save();
  return { bytes, source: 'pdflib-overlay' };
}

export const pdfLibFallbackEngine: EngineInterface = {
  kind: 'pdflib-overlay',
  detectTextBlocks: detectTextBlocksImpl,
  writeTextBlock: writeTextBlockImpl,
  parseFormFields: parseFormFieldsImpl,
  writeFormFields: writeFormFieldsImpl,
};

void pdfjsLib;
