// flatten.ts: turn editor overlays into pdf-lib draw commands on the
// corresponding PDF page. Coordinates live in the same space as PageMeta
// (top-left origin, y-down), so we flip the y-axis when talking to pdf-lib.
import {
  degrees,
  PDFDocument,
  PDFPage,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import type {
  DrawingItem,
  HighlightItem,
  ImageItem,
  OverlayItem,
  PageMeta,
  Rect,
  StickyNoteItem,
  TextBlockItem,
  TextItem,
} from '../types';
import { hexToRgb, pickStandardFont } from './helpers';

export async function flattenOverlays(
  doc: PDFDocument,
  overlays: OverlayItem[],
  pages: PageMeta[]
): Promise<void> {
  // Pre-embed the standard fonts we may need; we keep them in a cache so we
  // only embed each font once per export.
  const fontCache = new Map<StandardFonts, PDFFont>();
  async function getFont(name: StandardFonts): Promise<PDFFont> {
    const cached = fontCache.get(name);
    if (cached) return cached;
    const f = await doc.embedFont(name);
    fontCache.set(name, f);
    return f;
  }

  const pageById = new Map<string, { page: PDFPage; meta: PageMeta }>();
  pages.forEach((meta, idx) => {
    const page = doc.getPage(idx);
    pageById.set(meta.id, { page, meta });
  });

  for (const overlay of overlays) {
    const entry = pageById.get(overlay.pageId);
    if (!entry) continue;
    const { page, meta } = entry;
    const pageHeight = page.getHeight();

    switch (overlay.type) {
      case 'highlight': {
        drawHighlight(page, overlay, meta, pageHeight);
        break;
      }
      case 'note': {
        drawNote(page, overlay, pageHeight);
        break;
      }
      case 'text': {
        await drawTextItem(page, overlay, meta, pageHeight, getFont);
        break;
      }
      case 'image': {
        await drawImageItem(doc, page, overlay, pageHeight);
        break;
      }
      case 'drawing': {
        drawDrawing(page, overlay, pageHeight);
        break;
      }
      case 'text-block': {
        await drawTextBlock(page, overlay, meta, pageHeight, getFont);
        break;
      }
      case 'form-field': {
        // Reserved for Task 17 (AcroForm). Skip silently with a console note
        // so the export still succeeds.
        console.warn(
          `[flatten] overlay type "form-field" is not exported in MVP.`
        );
        break;
      }
      default: {
        const _exhaustive: never = overlay;
        void _exhaustive;
      }
    }
  }
}

function pdfYFromTop(
  rectTopY: number,
  rectHeight: number,
  pageHeight: number
): number {
  // Store is y-down from the top; pdf-lib wants y-up from the bottom.
  return pageHeight - rectTopY - rectHeight;
}

function drawHighlight(
  page: PDFPage,
  item: HighlightItem,
  meta: PageMeta,
  pageHeight: number
): void {
  const r: Rect = item.rect;
  const y = pdfYFromTop(r.y, r.h, pageHeight);
  page.drawRectangle({
    x: r.x,
    y,
    width: r.w,
    height: r.h,
    color: rgbFromHex(item.color),
    opacity: clamp(item.opacity, 0, 1),
    rotate: meta.rotation !== 0 ? degrees(meta.rotation) : undefined,
  });
}

function drawNote(
  page: PDFPage,
  item: StickyNoteItem,
  pageHeight: number
): void {
  // The sticky note is rendered as a small coloured square (the "icon") so
  // the user can spot the note in the exported PDF. The full text is drawn
  // next to it as a fallback.
  const y = pdfYFromTop(item.position.y, item.size.h, pageHeight);
  page.drawRectangle({
    x: item.position.x,
    y,
    width: item.size.h, // square icon: edge = height
    height: item.size.h,
    color: rgbFromHex(item.color),
    opacity: 0.9,
  });
  if (item.text) {
    page.drawText(item.text.slice(0, 80), {
      x: item.position.x + item.size.h + 4,
      y: y + 2,
      size: 8,
      color: rgb(0.1, 0.1, 0.1),
    });
  }
}

async function drawTextItem(
  page: PDFPage,
  item: TextItem,
  _meta: PageMeta,
  pageHeight: number,
  getFont: (name: StandardFonts) => Promise<PDFFont>
): Promise<void> {
  const fontName = pickStandardFont(item.font, item.bold, item.italic);
  const font = await getFont(fontName);
  const size = item.fontSize;
  // pdf-lib's drawText anchors at the baseline, which is at the bottom of the
  // text. The store's position is the top-left of the text box, so the
  // baseline is roughly `position.y + fontSize` in y-down coordinates.
  const yDown = pageHeight - item.position.y - size;
  const { r, g, b } = hexToRgb(item.color);
  page.drawText(item.text, {
    x: item.position.x,
    y: yDown,
    size,
    font,
    color: rgb(r, g, b),
    rotate: item.rotation !== 0 ? degrees(item.rotation) : undefined,
  });
}

async function drawTextBlock(
  page: PDFPage,
  item: TextBlockItem,
  meta: PageMeta,
  pageHeight: number,
  getFont: (name: StandardFonts) => Promise<PDFFont>
): Promise<void> {
  // Three sources:
  //   • mupdf           – MuPDF.js has already used Redact +
  //                       applyRedactions to wipe the original bytes
  //                       from the page content stream. The saved PDF
  //                       no longer contains the original glyphs at
  //                       all, so we just repaint the new text at the
  //                       same baseline, no white box.
  //   • pdfium          – the engine has already destroyed the original
  //                       page text object in the saved PDF; we just
  //                       repaint the new text at the original baseline,
  //                       no white box.
  //   • pdflib-overlay  – last-resort fallback: original stream byte is
  //                       still present, so we paint a white rectangle
  //                       first to obliterate the original glyphs
  //                       (best-effort, rounded font widths can leak).
  const r: Rect = item.bbox;
  const fontName = pickStandardFont(item.font, false, false);
  const font = await getFont(fontName);
  const size = item.fontSize;
  const baseline = pageHeight - r.y - size;
  const { r: rr, g: gg, b: bb } = hexToRgb(item.color);

  if (item.source === 'pdflib-overlay') {
    // White-out the original glyph region before drawing the new one.
    page.drawRectangle({
      x: r.x,
      y: pageHeight - r.y - r.h,
      width: r.w,
      height: r.h,
      color: rgb(1, 1, 1),
      opacity: 1,
    });
  }

  page.drawText(item.text, {
    x: r.x,
    y: baseline,
    size,
    font,
    color: rgb(rr, gg, bb),
    rotate: meta.rotation !== 0 ? degrees(meta.rotation) : undefined,
  });
}

async function drawImageItem(
  doc: PDFDocument,
  page: PDFPage,
  item: ImageItem,
  pageHeight: number
): Promise<void> {
  const bytes = base64ToBytes(item.bytes);
  let embedded;
  if (item.mime.includes('png')) {
    embedded = await doc.embedPng(bytes);
  } else if (item.mime.includes('jpeg') || item.mime.includes('jpg')) {
    embedded = await doc.embedJpg(bytes);
  } else {
    console.warn(
      `[flatten] image MIME "${item.mime}" is not supported; skipping image.`
    );
    return;
  }
  const y = pdfYFromTop(item.position.y, item.size.h, pageHeight);
  page.drawImage(embedded, {
    x: item.position.x,
    y,
    width: item.size.w,
    height: item.size.h,
    rotate: item.rotation !== 0 ? degrees(item.rotation) : undefined,
  });
}

function drawDrawing(
  page: PDFPage,
  item: DrawingItem,
  pageHeight: number
): void {
  // Parse the SVG path d string, simplify curves to polylines, and draw
  // each M..L segment as a series of drawLine calls.
  const segments = parsePathToSegments(item.path);
  const { r, g, b } = hexToRgb(item.color);
  const color = rgb(r, g, b);
  const width = Math.max(0.5, item.width);
  for (const seg of segments) {
    for (let i = 0; i < seg.length - 1; i += 1) {
      const a = seg[i];
      const b = seg[i + 1];
      page.drawLine({
        start: { x: a.x, y: pageHeight - a.y },
        end: { x: b.x, y: pageHeight - b.y },
        thickness: width,
        color,
      });
    }
  }
}

function parsePathToSegments(
  d: string
): Array<Array<{ x: number; y: number }>> {
  // Tokens: command letters plus numbers.
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  let cx = 0;
  let cy = 0;
  let i = 0;
  function readPt(): { x: number; y: number } {
    const x = Number(tokens[i]);
    const y = Number(tokens[i + 1]);
    i += 2;
    return { x, y };
  }
  while (i < tokens.length) {
    const tk = tokens[i];
    if (tk === 'M' || tk === 'm') {
      i += 1;
      const p = readPt();
      const isRelative = tk === 'm';
      if (isRelative && current.length > 0) {
        cx += p.x;
        cy += p.y;
      } else {
        cx = p.x;
        cy = p.y;
      }
      if (current.length > 0) segments.push(current);
      current = [{ x: cx, y: cy }];
    } else if (tk === 'L' || tk === 'l') {
      i += 1;
      const p = readPt();
      if (tk === 'l') {
        cx += p.x;
        cy += p.y;
      } else {
        cx = p.x;
        cy = p.y;
      }
      current.push({ x: cx, y: cy });
    } else if (tk === 'C' || tk === 'c') {
      // Cubic curves: ignore control points, line to the endpoint.
      i += 1;
      const p1 = readPt();
      const p2 = readPt();
      const p3 = readPt();
      void p1;
      void p2;
      if (tk === 'c') {
        cx += p3.x;
        cy += p3.y;
      } else {
        cx = p3.x;
        cy = p3.y;
      }
      current.push({ x: cx, y: cy });
    } else if (tk === 'H' || tk === 'h') {
      i += 1;
      const v = Number(tokens[i]);
      i += 1;
      cx = tk === 'h' ? cx + v : v;
      current.push({ x: cx, y: cy });
    } else if (tk === 'V' || tk === 'v') {
      i += 1;
      const v = Number(tokens[i]);
      i += 1;
      cy = tk === 'v' ? cy + v : v;
      current.push({ x: cx, y: cy });
    } else if (tk === 'Z' || tk === 'z') {
      i += 1;
      if (current.length > 0) {
        current.push({ x: current[0].x, y: current[0].y });
        segments.push(current);
        current = [];
      }
    } else {
      // Unknown / numeric-only continuation (implicit L) — treat as LineTo.
      const x = Number(tk);
      if (Number.isFinite(x)) {
        const y = Number(tokens[i + 1]);
        if (Number.isFinite(y)) {
          cx = x;
          cy = y;
          i += 2;
          current.push({ x: cx, y: cy });
          continue;
        }
      }
      i += 1;
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function rgbFromHex(hex: string): ReturnType<typeof rgb> {
  const { r, g, b } = hexToRgb(hex);
  return rgb(r, g, b);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
