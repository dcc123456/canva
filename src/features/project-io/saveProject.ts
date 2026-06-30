// saveProject.ts: serialize the current editor state and trigger a download.
import { useDocumentStore } from '../../store/documentStore';
import { useHistoryStore } from '../../store/historyStore';
import { serializeProject } from '../../core/project/serialize';
import { downloadBlob } from '../../utils/download';

export interface SaveResult {
  filename: string;
  bytes: number;
}

export function saveProject(): SaveResult {
  const { pdfBytes, pages, overlays, pdfName } = useDocumentStore.getState();
  const json = serializeProject({ pdfBytes, pages, overlays, pdfName });
  const baseName = (pdfName || 'document').replace(/\.pdf$/i, '');
  const filename = `${baseName}.minipdf.json`;
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, filename);
  // Saving is a non-data event; clear the history so the user can't
  // accidentally undo their "saved" snapshot.
  useHistoryStore.getState().clear();
  return { filename, bytes: blob.size };
}
