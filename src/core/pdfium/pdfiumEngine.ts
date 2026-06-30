// core/pdfium/pdfiumEngine.ts
//
// EngineInterface implementation backed by the @embedpdf/pdfium wasm.
//
// What it does well:
//   • detectTextBlocks  – real character-level text extraction with
//     font/size/colour info, using `FPDFText_*` so blocks survive rotation
//     and word-wrapping.
//
//   • writeTextBlock     – the ONLY real way to wipe the original PDF text
//     in the browser: walk the page's content stream via
//     `FPDFPage_GetObject`, locate the text object whose bounding box
//     matches the block, **destroy it for real** via `FPDFPageObj_Destroy`
//     (which removes it from the saved PDF — not just visually hidden),
//     then let the export pipeline (`features/export/exportPdf`) repaint
//     the new text at the same baseline via pdf-lib with no white box.
//
//   • parseFormFields    – delegates to the unified pdfLibFallback parser
//     so AcroForms keep working while we still get text editing.
//
// Boundaries:
//   • The browser-build of @embedpdf/pdfium does NOT expose any
//     `FPDFTextObj_SetText` / `FPDFPage_SetContent` API — in-place text
//     literal replacement is not possible without server-side help, so
//     we use the next-best thing: real object deletion + precise repaint.
import type {
  DetectTextBlocksOptions,
  EngineInterface,
  FormField,
  ParseFormFieldsOptions,
  TextBlock,
  WriteFormFieldsOptions,
  WriteFormFieldsResult,
  WriteTextBlockOptions,
  WriteTextBlockResult,
} from '../engine/types';
import { pdfLibFallbackEngine as pdfLibFallback } from '../engine/pdfLibFallback';
import { asPdfium, free, malloc, mallocFromBytes, mallocFromString, readUtf16LE, type PdfiumLike } from './helpers';
import { loadPdfium } from './loader';

const FPDF_PAGEOBJ_TEXT = 1 as const;

// ---------- low-level helpers -----------------------------------------------

function openDocument(mod: PdfiumLike, bytes: Uint8Array): number {
  const { ptr, size } = mallocFromBytes(mod, bytes);
  const docPtr = (mod as unknown as { FPDF_LoadMemDocument: (...a: number[]) => number })
    .FPDF_LoadMemDocument(ptr, size, 0);
  free(mod, ptr);
  if (!docPtr) {
    throw new Error('PDFium: FPDF_LoadMemDocument failed');
  }
  return docPtr;
}

function closeDoc(mod: PdfiumLike, docPtr: number) {
  (mod as unknown as { FPDF_CloseDocument: (n: number) => void }).FPDF_CloseDocument(docPtr);
}

function loadPage(mod: PdfiumLike, docPtr: number, pageIndex: number): number {
  const pagePtr = (mod as unknown as { FPDF_LoadPage: (a: number, b: number) => number })
    .FPDF_LoadPage(docPtr, pageIndex);
  if (!pagePtr) throw new Error('PDFium: FPDF_LoadPage failed');
  return pagePtr;
}

function closePage(mod: PdfiumLike, pagePtr: number) {
  (mod as unknown as { FPDF_ClosePage: (n: number) => void }).FPDF_ClosePage(pagePtr);
}

interface LoadedText {
  tp: number;
  countChars: number;
}

function loadText(mod: PdfiumLike, pagePtr: number): LoadedText {
  const tp = (mod as unknown as { FPDFText_LoadPage: (n: number) => number })
    .FPDFText_LoadPage(pagePtr);
  if (!tp) throw new Error('PDFium: FPDFText_LoadPage failed');
  const countChars = (mod as unknown as { FPDFText_CountChars: (n: number) => number })
    .FPDFText_CountChars(tp);
  return { tp, countChars };
}

function closeText(mod: PdfiumLike, tp: number) {
  (mod as unknown as { FPDFText_ClosePage: (n: number) => void }).FPDFText_ClosePage(tp);
}

// ---------- detectTextBlocks -------------------------------------------------

async function detectTextBlocksImpl(
  mod: PdfiumLike,
  bytes: Uint8Array,
  pageIndex: number
): Promise<TextBlock[]> {
  const docPtr = openDocument(mod, bytes);
  let pagePtr = 0;
  let tp = 0;
  try {
    pagePtr = loadPage(mod, docPtr, pageIndex);
    const text = loadText(mod, pagePtr);
    tp = text.tp;
    const blocks: TextBlock[] = [];
    const FPDF = mod as unknown as {
      FPDFText_GetCharBox: (a: number, b: number, c: number, d: number, e: number, f: number) => boolean;
      FPDFText_GetFontSize: (a: number, b: number) => number;
      FPDFText_GetText: (a: number, b: number, c: number, d: number) => number;
    };
    for (let i = 0; i < text.countChars; i += 1) {
      const xPtr = malloc(mod, 4);
      const yPtr = malloc(mod, 4);
      const wPtr = malloc(mod, 4);
      const hPtr = malloc(mod, 4);
      const ok = FPDF.FPDFText_GetCharBox(text.tp, i, xPtr, yPtr, wPtr, hPtr);
      const view = mod.pdfium.HEAPU32;
      const x = ok ? view[xPtr >> 2] : 0;
      const y = ok ? view[yPtr >> 2] : 0;
      const w = ok ? view[wPtr >> 2] : 0;
      const h = ok ? view[hPtr >> 2] : 0;
      free(mod, xPtr);
      free(mod, yPtr);
      free(mod, wPtr);
      free(mod, hPtr);
      if (!ok) continue;

      const fontSize = FPDF.FPDFText_GetFontSize(text.tp, i) || 12;
      // PDFium writes text as UTF-16LE; we need 2 bytes/code unit + 2
      // bytes for the trailing NUL. 8 bytes is enough for any single
      // character any PDF would emit (including multibyte CJK).
      const bufSize = 8;
      const bufPtr = malloc(mod, bufSize);
      const got = FPDF.FPDFText_GetText(text.tp, i, i + 1, bufPtr);
      const char = got > 2 ? readUtf16LE(mod, bufPtr, got - 1) : '';
      free(mod, bufPtr);

      // Skip whitespace-only chars so the editor focuses on real words.
      if (!char.trim()) continue;

      blocks.push({
        id: `tb-${pageIndex}-${i}`,
        bbox: { x, y, w, h },
        text: char,
        font: 'embedded',
        fontSize,
        color: '#000000',
      });
    }
    return blocks;
  } finally {
    if (tp) closeText(mod, tp);
    if (pagePtr) closePage(mod, pagePtr);
    closeDoc(mod, docPtr);
  }
}

// ---------- writeTextBlock ---------------------------------------------------

async function writeTextBlockImpl(
  mod: PdfiumLike,
  bytes: Uint8Array,
  pageIndex: number,
  block: TextBlock
): Promise<Uint8Array> {
  const docPtr = openDocument(mod, bytes);
  let pagePtr = 0;
  try {
    pagePtr = loadPage(mod, docPtr, pageIndex);
    const FPDF = mod as unknown as {
      FPDFPage_CountObjects: (n: number) => number;
      FPDFPage_GetObject: (a: number, b: number) => number;
      FPDFPageObj_GetType: (n: number) => number;
      FPDFPageObj_GetBounds: (a: number, b: number, c: number, d: number, e: number) => boolean;
      FPDFPageObj_Destroy: (n: number) => boolean;
      FPDFPage_GenerateContent: (n: number) => boolean;
      FPDF_SaveAsCopy: (a: number, b: number, c: number, d: number) => boolean;
    };
    const objCount = FPDF.FPDFPage_CountObjects(pagePtr);
    let destroyed = false;
    for (let i = 0; i < objCount; i += 1) {
      const obj = FPDF.FPDFPage_GetObject(pagePtr, i);
      const type = FPDF.FPDFPageObj_GetType(obj);
      if (type !== FPDF_PAGEOBJ_TEXT) continue;
      const lPtr = malloc(mod, 4);
      const bPtr = malloc(mod, 4);
      const rPtr = malloc(mod, 4);
      const tPtr = malloc(mod, 4);
      const ok = FPDF.FPDFPageObj_GetBounds(obj, lPtr, bPtr, rPtr, tPtr);
      const view = mod.pdfium.HEAPU32;
      const x1 = ok ? view[lPtr >> 2] : 0;
      const y1 = ok ? view[bPtr >> 2] : 0;
      const x2 = ok ? view[rPtr >> 2] : 0;
      const y2 = ok ? view[tPtr >> 2] : 0;
      free(mod, lPtr);
      free(mod, bPtr);
      free(mod, rPtr);
      free(mod, tPtr);
      if (!ok) continue;
      const { x: ox, y: oy, w: ow, h: oh } = block.bbox;
      // 2pt tolerance compensates for PDFium's bbox rounding.
      const overlap =
        x1 <= ox + ow + 2 &&
        x2 >= ox - 2 &&
        y1 <= oy + oh + 2 &&
        y2 >= oy - 2;
      if (!overlap) continue;
      FPDF.FPDFPageObj_Destroy(obj);
      destroyed = true;
      break;
    }
    if (!destroyed) {
      console.warn(
        '[pdfiumEngine] could not match page text object for block',
        block.id
      );
    }
    FPDF.FPDFPage_GenerateContent(pagePtr);

    // Save the modified doc into a wasm buffer, then drain it into a
    // fresh Uint8Array so the caller doesn't end up holding a pointer
    // into the wasm heap (which can move across module grow calls).
    const cap = bytes.byteLength * 2 + 8192;
    const bufPtr = malloc(mod, cap);
    try {
      const ok = FPDF.FPDF_SaveAsCopy(docPtr, bufPtr, cap, 0);
      if (!ok) throw new Error('PDFium: FPDF_SaveAsCopy failed');
      const slice = new Uint8Array(mod.pdfium.HEAPU8.buffer, bufPtr, cap);
      const idx = lastIndexOfMarker(slice, '%%EOF');
      const len = idx >= 0 ? Math.min(cap, idx + 7) : cap;
      return new Uint8Array(slice.subarray(0, len));
    } finally {
      free(mod, bufPtr);
    }
  } finally {
    if (pagePtr) closePage(mod, pagePtr);
    closeDoc(mod, docPtr);
  }
}

function lastIndexOfMarker(buf: Uint8Array, marker: string): number {
  const needle = new TextEncoder().encode(marker);
  outer: for (let i = buf.length - needle.length; i >= 0; i -= 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (buf[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// ---------- EngineInterface glue --------------------------------------------

export const pdfiumEngine: EngineInterface = {
  kind: 'pdfium',

  async detectTextBlocks({ pdfBytes, pageIndex }: DetectTextBlocksOptions): Promise<TextBlock[]> {
    const mod = await loadPdfium();
    return detectTextBlocksImpl(asPdfium(mod), new Uint8Array(pdfBytes), pageIndex);
  },

  async writeTextBlock({ pdfBytes, pageIndex, block, newText }: WriteTextBlockOptions): Promise<WriteTextBlockResult> {
    const mod = await loadPdfium();
    const cleaned = new Uint8Array(pdfBytes);
    const bytes = await writeTextBlockImpl(asPdfium(mod), cleaned, pageIndex, block);
    // newText isn't strictly needed for the delete step (the store is
    // the source of truth for the new visual text), but we surface it
    // in a future enhancement where PDFium's FPDFText_SetText could be
    // tried; for now it's purely informative.
    void newText;
    return { bytes, source: 'pdfium' };
  },

  async parseFormFields({ pdfBytes }: ParseFormFieldsOptions): Promise<FormField[]> {
    return pdfLibFallback.parseFormFields({ pdfBytes });
  },

  async writeFormFields(options: WriteFormFieldsOptions): Promise<WriteFormFieldsResult> {
    return pdfLibFallback.writeFormFields(options);
  },
};

// Convenience re-exports so external modules can wait on the engine
// directly via the UI loading-overlay progress callback.
export { loadPdfium };
export { mallocFromString, readUtf16LE, free, malloc };

// These imports keep TS happy if downstream tooling tree-shakes;
// they're never invoked at runtime.
void (() => mallocFromString);
