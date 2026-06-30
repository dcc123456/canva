// user.ts: user-created templates persisted in `localStorage`.
//
// Each entry is a `Template` object: `{ id, name, source: 'user', pdf (base64),
// thumbnail (data URL), createdAt }`. We keep the thumbnails inline so the
// gallery card can render synchronously on first paint.
//
// Private-mode browsers will throw on `localStorage.setItem`; we silently
// fall back to in-memory storage and log a warning so the UI can still
// show the template for the current session.
import { v4 as uuidv4 } from 'uuid';
import type { Template } from '../types';
import { toBase64, fromBase64 } from '../project/serialize';
import { loadDocument } from '../pdf/loader';

const STORAGE_KEY = 'canva.userTemplates';

let memoryFallback: Template[] | null = null;

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function safeRead(): Template[] {
  if (!hasLocalStorage()) return memoryFallback ?? [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTemplate);
  } catch (err) {
    console.warn('[userTemplates] failed to read storage:', err);
    return memoryFallback ?? [];
  }
}

function safeWrite(list: Template[]): void {
  if (!hasLocalStorage()) {
    memoryFallback = list;
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[userTemplates] failed to write storage:', err);
    memoryFallback = list;
  }
}

function isValidTemplate(v: unknown): v is Template {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.pdf === 'string' &&
    typeof t.createdAt === 'string' &&
    t.source === 'user'
  );
}

export function loadUserTemplates(): Template[] {
  return safeRead();
}

export function saveUserTemplates(templates: Template[]): void {
  safeWrite(templates);
}

/**
 * Render the first page of `pdfBytes` to a 200x280 PNG data URL using
 * pdfjs. Returns an empty string if rendering fails; callers should still
 * persist the template in that case so the user can re-open it later.
 */
async function generateThumbnailDataUrl(
  pdfBytes: Uint8Array
): Promise<string> {
  try {
    const doc = await loadDocument(pdfBytes);
    if (doc.numPages < 1) return '';
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const targetW = 200;
    const targetH = 280;
    const scale = Math.min(targetW / viewport.width, targetH / viewport.height);
    const scaled = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(scaled.width));
    canvas.height = Math.max(1, Math.floor(scaled.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;
    page.cleanup();
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[userTemplates] thumbnail generation failed:', err);
    return '';
  }
}

export interface AddUserTemplateOptions {
  /** Skip thumbnail generation (faster, used by tests). */
  skipThumbnail?: boolean;
}

/**
 * Build a new user template record from raw PDF bytes, persist it, and
 * return the resulting record. The thumbnail is generated asynchronously
 * by rendering page 1 with pdfjs.
 */
export async function addUserTemplate(
  name: string,
  pdfBytes: Uint8Array,
  options: AddUserTemplateOptions = {}
): Promise<Template> {
  const thumbnail = options.skipThumbnail
    ? ''
    : await generateThumbnailDataUrl(pdfBytes);
  const tpl: Template = {
    id: uuidv4(),
    name,
    source: 'user',
    pdf: toBase64(pdfBytes),
    thumbnail: thumbnail || undefined,
    createdAt: new Date().toISOString(),
  };
  const all = safeRead();
  all.push(tpl);
  safeWrite(all);
  return tpl;
}

export function removeUserTemplate(id: string): void {
  const next = safeRead().filter((t) => t.id !== id);
  safeWrite(next);
}

export function getUserTemplate(id: string): Template | undefined {
  return safeRead().find((t) => t.id === id);
}

/** Decode a Template's base64 PDF back to bytes. */
export function userTemplateBytes(t: Template): Uint8Array {
  return fromBase64(t.pdf);
}