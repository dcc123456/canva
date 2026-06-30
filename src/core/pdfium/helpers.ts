// core/pdfium/helpers.ts
//
// Thin alloc/free + UTF-8 bridge around the @embedpdf/pdfium wrapper.
// All FPDF_* calls require little-endian pointers; pdfjs + other libs in
// this codebase pass Uint8Array data into PDFium through these helpers.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

/**
 * PDFium's Emscripten wrapper always exposes the standard
 * Emscripten-runtime heap views (`HEAPU8`, `HEAPU32`) at runtime; the
 * TypeScript declarations omit them because they live behind
 * `EmscriptenModule`. We centralise the cast here so callers don't have
 * to keep `(mod as any)` everywhere.
 */
export type PdfiumLike = WrappedPdfiumModule & {
  pdfium: WrappedPdfiumModule['pdfium'] & {
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    HEAPF32: Float32Array;
    UTF8ToString(ptr: number, maxBytes?: number): string;
    stringToUTF8(str: string, outPtr: number, maxBytes: number): number;
    lengthBytesUTF8?: (s: string) => number;
  };
};

export function asPdfium(mod: WrappedPdfiumModule): PdfiumLike {
  return mod as unknown as PdfiumLike;
}

export function malloc(mod: PdfiumLike, size: number): number {
  return mod.pdfium.wasmExports.malloc(size) as unknown as number;
}

export function free(mod: PdfiumLike, ptr: number): void {
  mod.pdfium.wasmExports.free(ptr as unknown as number);
}

/**
 * Copy a JS Uint8Array into a freshly-malloc'd wasm buffer and return the
 * pointer + size. Use `free(mod, ptr)` after the call returns.
 */
export function mallocFromBytes(
  mod: PdfiumLike,
  bytes: Uint8Array
): { ptr: number; size: number } {
  const size = bytes.byteLength;
  const ptr = malloc(mod, size);
  new Uint8Array(mod.pdfium.HEAPU8.buffer, ptr, size).set(bytes);
  return { ptr, size };
}

/** Allocate-and-write a UTF-8 string. */
export function mallocFromString(
  mod: PdfiumLike,
  s: string,
  extraBytes = 1
): { ptr: number; max: number } {
  // Oversize by 4x so JS↔UTF-8 conversion is always able to write the
  // string + nul terminator without truncating.
  const max = Math.max(8, (s.length + extraBytes) * 4);
  const ptr = malloc(mod, max);
  mod.pdfium.stringToUTF8(s, ptr, max);
  return { ptr, max };
}

/** Read up to `maxBytes` UTF-8 starting at the wasm pointer `ptr`. */
export function readUtf8(mod: PdfiumLike, ptr: number, maxBytes: number): string {
  if (!ptr) return '';
  return mod.pdfium.UTF8ToString(ptr, maxBytes);
}

/**
 * Read up to `byteLength` bytes starting at the wasm pointer `ptr` and
 * decode them as UTF-16LE. PDFium's `FPDFText_*` functions always write
 * text in UTF-16LE, NOT UTF-8, so passing those bytes to `UTF8ToString`
 * blows up with "Invalid UTF-8 leading byte 0xa1" the moment it hits a
 * non-ASCII character.
 */
export function readUtf16LE(
  mod: PdfiumLike,
  ptr: number,
  byteLength: number
): string {
  // `ptr === 0` is a perfectly valid heap offset — the early-return
  // below must only kick in when there is genuinely no data to read.
  if (byteLength <= 0) return '';
  const view = new Uint8Array(mod.pdfium.HEAPU8.buffer, ptr, byteLength);
  // PDFium writes a UTF-16LE NUL terminator (2 bytes 00 00) at the end
  // of the text. The decoder maps that to a single "\0" we want stripped
  // before returning to the caller.
  return new TextDecoder('utf-16le').decode(view).replace(/\0+$/g, '');
}
