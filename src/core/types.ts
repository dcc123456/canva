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
export interface TextBlockItem extends OverlayBase {
  type: 'text-block';
  bbox: Rect;
  originalText: string;
  text: string;
  font: string;
  fontSize: number;
  color: string;
  source: 'mupdf' | 'pdflib-overlay' | 'pdfium';
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
