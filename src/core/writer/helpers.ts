// helpers.ts: shared utilities for the writer/ directory.
import { StandardFonts } from 'pdf-lib';

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
  if (lower.includes('times')) {
    if (bold) return StandardFonts.TimesRomanBold;
    return StandardFonts.TimesRoman;
  }
  if (lower.includes('courier')) {
    if (bold) return StandardFonts.CourierBold;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}
