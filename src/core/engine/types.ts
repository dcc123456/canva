// Engine abstraction: a common interface for text-block detection and
// form-field parsing.
//
// 重构后引擎只保留"只读"能力(detect/parse)。文本编辑不再在编辑时
// 调引擎 -- 编辑只改 overlay,导出时统一应用。表单字段导出时用
// pdf-lib form API 重建,不再调引擎 writeFormFields。
//
// 引擎路由(core/engine/router.ts)仍按 mupdf > pdfium > pdflib-overlay
// 优先级选择,用于 detectTextBlocks / parseFormFields。
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

export interface DetectTextBlocksOptions {
  /** Optional current page index; some engines can be page-aware. */
  pageIndex: number;
  /** Raw PDF bytes of the source document. */
  pdfBytes: Uint8Array;
}

export interface ParseFormFieldsOptions {
  pdfBytes: Uint8Array;
}

export interface EngineInterface {
  /** Identifier of the engine implementation. */
  readonly kind: EngineKind;

  /** Detect text blocks on a given page. */
  detectTextBlocks(
    options: DetectTextBlocksOptions
  ): Promise<TextBlock[]>;

  /** Parse all AcroForm fields across the document. */
  parseFormFields(options: ParseFormFieldsOptions): Promise<FormField[]>;
}
