// thumbnail.ts: render the first page of a PDF to a 200x280 JPEG
// data-URL using pdf.js. The result is what the start-page card
// shows when a template has no pre-baked thumbnail.
import { loadDocument } from '../pdf/loader';

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number; // 0..1
}

const DEFAULT_W = 200;
const DEFAULT_H = 280;
const DEFAULT_QUALITY = 0.7;

/**
 * Render page 1 of the given PDF bytes to a JPEG data URL.
 * Returns `null` on any error so callers can show a placeholder
 * without try/catching each call.
 */
export async function generateThumbnail(
  pdfBytes: Uint8Array,
  options: ThumbnailOptions = {}
): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const width = options.width ?? DEFAULT_W;
  const height = options.height ?? DEFAULT_H;
  const quality = options.quality ?? DEFAULT_QUALITY;
  try {
    const doc = await loadDocument(pdfBytes);
    if (doc.numPages < 1) return null;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(width / viewport.width, height / viewport.height);
    const scaled = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(scaled.width));
    canvas.height = Math.max(1, Math.floor(scaled.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;
    page.cleanup();
    return canvas.toDataURL('image/jpeg', quality);
  } catch (err) {
    console.warn('[thumbnail] failed to render:', err);
    return null;
  }
}
