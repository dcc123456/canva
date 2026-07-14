// helpers.ts: shared utilities for the writer/ directory.
import { StandardFonts } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';

/** CJK font names that map to Helvetica in the standard-font fallback. */
const CJK_FONT_PATTERNS = ['simsun', 'simhei', 'yahei', 'kaiti'];

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  let body = m[1];
  if (body.length === 3) {
    body = body
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;
  return { r, g, b };
}

export function pickStandardFont(
  font: string,
  bold: boolean,
  italic: boolean
): StandardFonts {
  const lower = font.toLowerCase();

  // CJK font names (SimSun, SimHei, Microsoft YaHei, KaiTi, etc.):
  // return Helvetica family. The actual CJK rendering uses Source Han Sans
  // loaded separately via fontkit in the export pipeline.
  if (CJK_FONT_PATTERNS.some((p) => lower.includes(p))) {
    if (bold && italic) return StandardFonts.HelveticaBoldOblique;
    if (bold) return StandardFonts.HelveticaBold;
    if (italic) return StandardFonts.HelveticaOblique;
    return StandardFonts.Helvetica;
  }

  if (lower.includes('times')) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (lower.includes('courier')) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  // Default (Helvetica and anything else)
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

/**
 * Wrap text to fit within maxWidth using the given font and size.
 * CJK characters break per-character; ASCII text breaks per-word.
 * Existing `\n` characters are respected as explicit line breaks.
 */
export function wrapText(
  font: PDFFont,
  text: string,
  maxWidth: number,
  size: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    const hasCjk = [...paragraph].some(
      (ch) => (ch.codePointAt(0) ?? 0) > 0x7e
    );
    let currentLine = '';
    if (hasCjk) {
      // CJK: break by individual character
      for (const char of paragraph) {
        const testLine = currentLine + char;
        if (
          font.widthOfTextAtSize(testLine, size) > maxWidth &&
          currentLine !== ''
        ) {
          lines.push(currentLine);
          currentLine = char;
        } else {
          currentLine = testLine;
        }
      }
    } else {
      // ASCII: break by word (space-separated)
      const words = paragraph.split(' ');
      for (const word of words) {
        const testLine =
          currentLine === '' ? word : currentLine + ' ' + word;
        if (
          font.widthOfTextAtSize(testLine, size) > maxWidth &&
          currentLine !== ''
        ) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
    }
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Compute the x-offset for a line of text given the alignment mode.
 */
export function alignedX(
  align: 'left' | 'center' | 'right',
  boxX: number,
  boxW: number,
  textW: number
): number {
  if (align === 'center') return boxX + (boxW - textW) / 2;
  if (align === 'right') return boxX + (boxW - textW);
  return boxX;
}
