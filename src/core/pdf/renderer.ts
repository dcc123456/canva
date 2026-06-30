// PDF page renderer: draws a single page to a canvas at the requested scale.
import type { PDFPageProxy } from 'pdfjs-dist';

export interface RenderOptions {
  scale?: number;
  rotation?: number;
  dpr?: number;
  background?: string;
}

export async function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  options: RenderOptions = {}
): Promise<void> {
  const { scale = 1, rotation = page.rotate, dpr = window.devicePixelRatio || 1 } = options;

  const viewport = page.getViewport({ scale, rotation });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D canvas context');

  // Size the backing store for HiDPI devices.
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Reset state from a previous render to avoid leftover pixels.
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  const task = page.render({
    canvas,
    canvasContext: ctx,
    viewport,
  });
  await task.promise;
}
