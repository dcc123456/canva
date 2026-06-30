// text-overlay.ts: write a TextItem as a pdf-lib overlay (fallback path for
// when MuPDF-driven real text editing is unavailable). This is essentially a
// thin wrapper around the relevant branch of flatten.ts, kept separate so
// the higher-level "edit real text" path can call into it independently.
import {
  degrees,
  type PDFDocument,
  type PDFPage,
  rgb,
} from 'pdf-lib';
import type { PageMeta, TextItem } from '../types';
import { hexToRgb, pickStandardFont } from './helpers';

export interface DrawTextOverlayOptions {
  /** Override the rotation of the page. Defaults to the page meta's rotation. */
  pageRotation?: number;
}

export async function drawTextOverlay(
  doc: PDFDocument,
  page: PDFPage,
  pageMeta: PageMeta,
  item: TextItem,
  options: DrawTextOverlayOptions = {}
): Promise<void> {
  void pageMeta;
  const fontName = pickStandardFont(item.font, item.bold, item.italic);
  const font = await doc.embedFont(fontName);
  const size = item.fontSize;
  const pageHeight = page.getHeight();
  // Store uses y-down; pdf-lib uses y-up.
  const pdfY = pageHeight - item.position.y - size;
  const { r, g, b } = hexToRgb(item.color);
  const rotation = options.pageRotation ?? 0;
  page.drawText(item.text, {
    x: item.position.x,
    y: pdfY,
    size,
    font,
    color: rgb(r, g, b),
    rotate:
      rotation !== 0
        ? degrees(rotation)
        : item.rotation !== 0
        ? degrees(item.rotation)
        : undefined,
  });
}
