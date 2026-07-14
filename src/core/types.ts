// Core domain types for the mini PDF editor.

export type Tool =
  | 'select'
  | 'edit-text'
  | 'highlight'
  | 'note'
  | 'text'
  | 'image'
  | 'draw'
  | 'signature'
  | 'form';

/** Rich-text segment for inline styling within a text element. */
export interface RichTextSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface PageMeta {
  id: string;
  index: number;
  rotation: 0 | 90 | 180 | 270;
  width: number;
  height: number;
  isBlank?: boolean;
}

export interface OverlayBase {
  id: string;
  pageId: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// F2
export interface HighlightItem extends OverlayBase {
  type: 'highlight';
  rect: Rect;
  color: string;
  opacity: number;
}

export interface StickyNoteItem extends OverlayBase {
  type: 'note';
  position: { x: number; y: number };
  size: { w: number; h: number };
  text: string;
  color: string;
}

// F3
export interface TextItem extends OverlayBase {
  type: 'text';
  position: { x: number; y: number };
  size: { w: number; h: number };
  rotation: number;
  text: string;
  font: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Text alignment within the text box. Defaults to 'left'. */
  align?: TextAlign;
  /** Line height multiplier. Defaults to 1.2. */
  lineHeight?: number;
  /** Optional rich-text segments. When absent, the whole text uses bold/italic/color. */
  segments?: RichTextSegment[];
}

// F4
export interface ImageItem extends OverlayBase {
  type: 'image';
  position: { x: number; y: number };
  size: { w: number; h: number };
  rotation: number;
  bytes: string; // base64
  mime: string;
}

// F6
export interface DrawingItem extends OverlayBase {
  type: 'drawing';
  path: string;
  color: string;
  width: number;
}

// F10
// 重构后文本编辑只更新 overlay，不再回写 pdfBytes。
// "是否被编辑过" = text !== originalText || bbox 移动了；
// 导出时据此决定是否需要在原 PDF 上对原字做字符级白底覆盖并重画新字。
// originalBbox 是检测时的原始位置(永不改)，bbox 是当前位置(可被拖动)。
// 白底画在 originalBbox(盖原字)，新字画在 bbox(新位置)。
export interface TextBlockItem extends OverlayBase {
  type: 'text-block';
  bbox: Rect;
  originalBbox: Rect;
  originalText: string;
  text: string;
  font: string;
  fontSize: number;
  color: string;
  lineHeight: number;
  bold: boolean;
  italic: boolean;
  /** Text alignment within the block. Defaults to 'left'. */
  align?: TextAlign;
  /** Optional rich-text segments. When absent, the whole text uses bold/italic/color. */
  segments?: RichTextSegment[];
}

// F11
export interface FormFieldItem extends OverlayBase {
  type: 'form-field';
  fieldName: string;
  kind: 'text' | 'checkbox' | 'radio' | 'select' | 'signature';
  bbox: Rect;
  options?: string[];
  value: string | boolean;
}

export type OverlayItem =
  | HighlightItem
  | StickyNoteItem
  | TextItem
  | ImageItem
  | DrawingItem
  | TextBlockItem
  | FormFieldItem;

export interface ProjectFile {
  version: 2;
  pdf: string; // base64 of original PDF
  pages: PageMeta[];
  overlays: OverlayItem[];
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  thumbnail?: string;
  source: 'builtin' | 'user';
  pdf: string; // base64
  createdAt: string;
}
