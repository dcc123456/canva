// core/pdfium/loader.ts
//
// Wraps @embedpdf/pdfium (PDFium-WebAssembly) into a singleton promise.
// We never bundle the wasm directly into Vite's output: it's ~4.6 MB and
// blocking to parse, so we lazy-load it from /pdfium.wasm (served from
// `public/`). In production, configure the CDN to serve that path.
//
// In non-browser environments (Node integration tests) `fetch('/path')`
// blows up with "Invalid URL" because there's no document base. We
// therefore fall back to `loadPdfiumFromBytes(bytes)` when `fetch`
// isn't available or when the caller has already provided bytes.
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';

let pdfiumPromise: Promise<WrappedPdfiumModule> | null = null;

async function bootPdfium(
  binary: Uint8Array,
  onProgress?: (p: number, label?: string) => void
): Promise<WrappedPdfiumModule> {
  onProgress?.(0.6, 'compiling wasm');
  const ab = binary.buffer.slice(
    binary.byteOffset,
    binary.byteOffset + binary.byteLength
  );
  const mod = await init({ wasmBinary: ab });
  onProgress?.(0.85, 'PDFiumExt_Init');
  mod.PDFiumExt_Init();
  onProgress?.(1, 'engine ready');
  return mod;
}

export async function loadPdfium(
  onProgress?: (p: number, label?: string) => void
): Promise<WrappedPdfiumModule> {
  if (pdfiumPromise) return pdfiumPromise;
  pdfiumPromise = (async () => {
    onProgress?.(0.05, 'fetching wasm');
    if (typeof fetch === 'function') {
      try {
        const res = await fetch('/pdfium.wasm', { cache: 'force-cache' });
        if (res.ok) {
          onProgress?.(0.35, 'reading bytes');
          const ab = await res.arrayBuffer();
          const fresh = new Uint8Array(ab);
          return await bootPdfium(fresh, onProgress);
        }
        throw new Error(`pdfium.wasm fetch failed: ${res.status}`);
      } catch (err) {
        // Likely running under Node test runner — try the byte-only API.
        console.warn(
          '[loader] fetch(/pdfium.wasm) failed, falling back to byte-init:',
          err
        );
      }
    }
    throw new Error(
      'No WASM source available: call loadPdfiumFromBytes(...) explicitly when running in Node.'
    );
  })().catch((err) => {
    pdfiumPromise = null;
    throw err;
  });
  return pdfiumPromise;
}

/**
 * Byte-injection path so Node integration tests (and any non-fetch
 * environment) can drive the engine without HTTP. Kept here instead of
 * in the public exports — only the tests should use this.
 */
export async function loadPdfiumFromBytes(
  bytes: Uint8Array,
  onProgress?: (p: number, label?: string) => void
): Promise<WrappedPdfiumModule> {
  if (pdfiumPromise) return pdfiumPromise;
  pdfiumPromise = bootPdfium(bytes, onProgress).catch((err) => {
    pdfiumPromise = null;
    throw err;
  });
  return pdfiumPromise;
}

export type { WrappedPdfiumModule };
