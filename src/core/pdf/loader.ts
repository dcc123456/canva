// PDF.js loader: wraps getDocument and configures the worker using Vite's ?url import.
import * as pdfjsLib from 'pdfjs-dist';
// Use Vite's ?url to copy the worker file to the build output and resolve its URL.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export type PdfSource = string | URL | Uint8Array | ArrayBuffer;

export async function loadDocument(source: PdfSource): Promise<PDFDocumentProxy> {
  const params: Parameters<typeof pdfjsLib.getDocument>[0] =
    typeof source === 'string' || source instanceof URL
      ? { url: source.toString() }
      : { data: source };
  const task = pdfjsLib.getDocument(params);
  return task.promise;
}

export { pdfjsLib };
