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
import fontkit from '@pdf-lib/fontkit';
import type {
  DrawingItem,
  HighlightItem,
  ImageItem,
  OverlayItem,
  PageMeta,
  Rect,
  StickyNoteItem,
  TextItem,
} from '../types';
import { hexToRgb, pickStandardFont, wrapText, alignedX } from './helpers';
import { loadCjkFontBytes, containsNonAscii } from './cjkFont';

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

  // CJK 字体支持:便签/文字工具的文字可能含中文,StandardFonts 不支持。
  let cjkFont: PDFFont | null = null;
  let cjkFontAttempted = false;

  async function getFontForText(
    text: string,
    bold = false,
    italic = false,
    fontName = 'Helvetica'
  ): Promise<{ font: PDFFont; safe: string }> {
    const needsCjk = containsNonAscii(text);
    if (needsCjk) {
      if (!cjkFontAttempted) {
        cjkFontAttempted = true;
        doc.registerFontkit(fontkit);
        const bytes = await loadCjkFontBytes();
        if (bytes) {
          cjkFont = await doc.embedFont(bytes, { subset: false });
        }
      }
      if (cjkFont) {
        return { font: cjkFont, safe: text };
      }
      // CJK 不可用 -- 替换为 '?' 降级。
      const name = pickStandardFont(fontName, bold, italic);
      const f = await getFont(name);
      let safe = '';
      for (const ch of text) {
        safe += (ch.codePointAt(0) ?? 0) > 0x7e ? '?' : ch;
      }
      return { font: f, safe };
    }
    const name = pickStandardFont(fontName, bold, italic);
    const f = await getFont(name);
    return { font: f, safe: text };
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
        await drawNote(page, overlay, pageHeight, getFontForText);
        break;
      }
      case 'text': {
        await drawTextItem(page, overlay, meta, pageHeight, getFontForText);
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
        // text-block 由 applyTextBlockRedraws 统一处理(redact 删字 + 重画新字,
        // 未编辑的原字已在 PDF 里)。flatten 阶段跳过。
        break;
      }
      case 'form-field': {
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

// Phase 7: unified note style - square corners, opacity 0.9, stroke #a16207,
// text 80 chars with \n multi-line support, CJK font via getFontForText.
async function drawNote(
  page: PDFPage,
  item: StickyNoteItem,
  pageHeight: number,
  getFontForText: (
    text: string,
    bold?: boolean,
    italic?: boolean,
    fontName?: string
  ) => Promise<{ font: PDFFont; safe: string }>
): Promise<void> {
  const y = pdfYFromTop(item.position.y, item.size.h, pageHeight);
  page.drawRectangle({
    x: item.position.x,
    y,
    width: item.size.w,
    height: item.size.h,
    color: rgbFromHex(item.color),
    opacity: 0.9,
    borderColor: rgbFromHex('#a16207'),
    borderWidth: 1,
  });
  if (item.text) {
    const snippet = item.text.slice(0, 80);
    const { font, safe } = await getFontForText(snippet);
    const lines = safe.split('\n');
    const fontSize = 10;
    const lineStep = fontSize * 1.2;
    // Baseline of first line: 16pt from the top of the note (matches SVG).
    const baseY = y + item.size.h - 16;
    for (let i = 0; i < lines.length; i++) {
      page.drawText(lines[i], {
        x: item.position.x + 6,
        y: baseY - i * lineStep,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
  }
}

// Phase 2+3+4+6: drawTextItem with multi-line, auto-wrap, alignment, segments.
async function drawTextItem(
  page: PDFPage,
  item: TextItem,
  _meta: PageMeta,
  pageHeight: number,
  getFontForText: (
    text: string,
    bold?: boolean,
    italic?: boolean,
    fontName?: string
  ) => Promise<{ font: PDFFont; safe: string }>
): Promise<void> {
  const fontSize = item.fontSize;
  const lineHeight = item.lineHeight || 1.2;
  const align = item.align || 'left';
  const boxX = item.position.x;
  const boxY = item.position.y;
  const boxW = item.size.w;
  const rotation = item.rotation;
  const { r, g, b } = hexToRgb(item.color);

  if (item.segments && item.segments.length > 0) {
    // Phase 6: draw segments sequentially with per-line alignment.
    // Each segment may contain \n which starts a new line.
    type SegInfo = {
      text: string;
      font: PDFFont;
      width: number;
      color: string;
    };
    const lines: SegInfo[][] = [[]];

    for (const seg of item.segments) {
      const segBold = seg.bold ?? item.bold;
      const segItalic = seg.italic ?? item.italic;
      const segColor = seg.color || item.color;
      const parts = seg.text.split('\n');
      for (let pi = 0; pi < parts.length; pi++) {
        if (pi > 0) lines.push([]);
        const partText = parts[pi];
        if (partText) {
          const { font, safe } = await getFontForText(
            partText,
            segBold,
            segItalic,
            item.font
          );
          const width = font.widthOfTextAtSize(safe, fontSize);
          lines[lines.length - 1].push({
            text: safe,
            font,
            width,
            color: segColor,
          });
        }
      }
    }

    const lineStep = fontSize * lineHeight;
    for (let li = 0; li < lines.length; li++) {
      const segs = lines[li];
      if (segs.length === 0) continue;
      const totalW = segs.reduce((sum, s) => sum + s.width, 0);
      let x = alignedX(align, boxX, boxW, totalW);
      const y = pageHeight - boxY - fontSize - li * lineStep;
      for (const s of segs) {
        const { r: sr, g: sg, b: sb } = hexToRgb(s.color);
        page.drawText(s.text, {
          x,
          y,
          size: fontSize,
          font: s.font,
          color: rgb(sr, sg, sb),
          rotate: rotation !== 0 ? degrees(rotation) : undefined,
        });
        x += s.width;
      }
    }
  } else {
    // No segments: use whole-text bold/italic/color with auto-wrap.
    const { font, safe } = await getFontForText(
      item.text,
      item.bold,
      item.italic,
      item.font
    );
    const wrappedLines = wrapText(font, safe, boxW, fontSize);
    const lineStep = fontSize * lineHeight;
    for (let i = 0; i < wrappedLines.length; i++) {
      const lineW = font.widthOfTextAtSize(wrappedLines[i], fontSize);
      const x = alignedX(align, boxX, boxW, lineW);
      const y = pageHeight - boxY - fontSize - i * lineStep;
      page.drawText(wrappedLines[i], {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(r, g, b),
        rotate: rotation !== 0 ? degrees(rotation) : undefined,
      });
    }
  }
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
