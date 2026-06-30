// deserialize.ts: parse a .minipdf.json string back into a ProjectFile,
// validating the version along the way.
import type { OverlayItem, PageMeta, ProjectFile } from '../types';
import { fromBase64 } from './serialize';

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

/** Loose shape used during validation before we trust the file. */
interface RawProject {
  version?: unknown;
  pdf?: unknown;
  pages?: unknown;
  overlays?: unknown;
  createdAt?: unknown;
}

export function deserializeProject(json: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new ProjectFileError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!raw || typeof raw !== 'object') {
    throw new ProjectFileError('Project file must be a JSON object');
  }
  const obj = raw as RawProject;
  if (obj.version !== 2) {
    throw new ProjectFileError(
      `Unsupported project file version: ${String(obj.version)}`
    );
  }
  if (typeof obj.pdf !== 'string') {
    throw new ProjectFileError('Project file is missing the PDF payload');
  }
  if (!Array.isArray(obj.pages)) {
    throw new ProjectFileError('Project file is missing the pages array');
  }
  if (!Array.isArray(obj.overlays)) {
    throw new ProjectFileError('Project file is missing the overlays array');
  }
  if (typeof obj.createdAt !== 'string') {
    throw new ProjectFileError('Project file is missing createdAt');
  }

  const pages = obj.pages as PageMeta[];
  const overlays = obj.overlays as OverlayItem[];

  return {
    version: 2,
    pdf: obj.pdf,
    pages,
    overlays,
    createdAt: obj.createdAt,
  };
}

export function decodeProjectPdf(file: ProjectFile): Uint8Array | null {
  if (!file.pdf) return null;
  return fromBase64(file.pdf);
}
