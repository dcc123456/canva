// serialize.ts: turn the current editor state into a stable JSON string
// suitable for saving to disk as a .minipdf.json file.
import type { OverlayItem, PageMeta, ProjectFile } from '../types';

export interface SerializableState {
  pdfBytes: Uint8Array | null;
  pages: PageMeta[];
  overlays: OverlayItem[];
  pdfName: string;
}

const PROJECT_VERSION = 2 as const;

export function toBase64(bytes: Uint8Array): string {
  // Chunked encoding to avoid the call-stack limit on very large PDFs.
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function serializeProject(state: SerializableState): string {
  const file: ProjectFile = {
    version: PROJECT_VERSION,
    pdf: state.pdfBytes ? toBase64(state.pdfBytes) : '',
    pages: state.pages,
    overlays: state.overlays,
    createdAt: new Date().toISOString(),
  };
  return JSON.stringify(file);
}
