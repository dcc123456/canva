// Engine abstraction: a common interface for "edit" operations
// (text-block detection, text-block write, form-field parse, form-field write).
//
// Three engines implement this interface:
//   * `mupdf`         – uses the official Artifex `mupdf` npm package
//                        (MuPDF.js WebAssembly). This is the *preferred*
//                        engine for text editing: `Redact +
//                        applyRedactions` does true byte-level deletion of
//                        the original glyphs in the content stream.
//   * `pdfium`        – legacy WebAssembly path via @embedpdf/pdfium. Used
//                        as a backup if MuPDF.js fails to load.
//   * `pdflib-overlay`– pdfjs + pdf-lib fallback. White-out the area, then
//                        redraw new text on top. Non byte-level.
//
// The router (`core/engine/router.ts`) returns the best available one in
// the priority order: mupdf > pdfium > pdflib-overlay.
import type { Rect } from '../types';

export type EngineKind = 'mupdf' | 'pdflib-overlay' | 'pdfium';

export interface TextBlock {
  id: string;
  bbox: Rect;
  text: string;
  font: string;
  fontSize: number;
  color: string;
}

export type FormFieldKind =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'signature';

export interface FormField {
  id: string;
  pageIndex: number;
  fieldName: string;
  kind: FormFieldKind;
  bbox: Rect;
  value: string | boolean;
  options?: string[];
}

export interface WriteTextBlockResult {
  /** New PDF bytes after writing. */
  bytes: Uint8Array;
  /** Which engine actually produced the bytes. */
  source: EngineKind;
}

export interface WriteFormFieldsResult {
  bytes: Uint8Array;
  source: EngineKind;
}

export interface DetectTextBlocksOptions {
  /** Optional current page index; some engines can be page-aware. */
  pageIndex: number;
  /** Raw PDF bytes of the source document. */
  pdfBytes: Uint8Array;
}

export interface ParseFormFieldsOptions {
  pdfBytes: Uint8Array;
}

export interface WriteTextBlockOptions {
  pageIndex: number;
  blockId: string;
  newText: string;
  /** The original text-block, used by the fallback to know bbox/font/etc. */
  block: TextBlock;
  pdfBytes: Uint8Array;
}

export interface WriteFormFieldsOptions {
  pdfBytes: Uint8Array;
  values: FormField[];
}

export interface EngineInterface {
  /** Identifier of the engine implementation. */
  readonly kind: EngineKind;

  /** Detect text blocks on a given page. */
  detectTextBlocks(
    options: DetectTextBlocksOptions
  ): Promise<TextBlock[]>;

  /** Replace the text of a single detected block. */
  writeTextBlock(options: WriteTextBlockOptions): Promise<WriteTextBlockResult>;

  /** Parse all AcroForm fields across the document. */
  parseFormFields(options: ParseFormFieldsOptions): Promise<FormField[]>;

  /** Write all form fields with their new values. */
  writeFormFields(options: WriteFormFieldsOptions): Promise<WriteFormFieldsResult>;
}
