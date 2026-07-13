// loadProject.ts: prompt for a .minipdf.json file, parse it, and
// hydrate the documentStore / editorStore.
import { decodeProjectPdf, deserializeProject, ProjectFileError } from '../../core/project/deserialize';
import { useDocumentStore } from '../../store/documentStore';
import { useEditorStore } from '../../store/editorStore';
import { useHistoryStore } from '../../store/historyStore';
import { loadDocument } from '../../core/pdf/loader';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface LoadResult {
  filename: string;
  pageCount: number;
}

export interface LoadOptions {
  /** Called with the freshly-loaded pdfjs document so the caller can keep
   *  its own reference (e.g. for the Viewer). */
  onPdfJsDoc?: (doc: PDFDocumentProxy | null) => void;
}

export function loadProject(opts: LoadOptions = {}): Promise<LoadResult> {
  return new Promise<LoadResult>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.minipdf.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    function finish(err: Error | null, value?: LoadResult) {
      if (settled) return;
      settled = true;
      input.remove();
      if (err) reject(err);
      else if (value) resolve(value);
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => finish(reader.error ?? new Error('Read failed'));
      reader.onload = async () => {
        const text = String(reader.result ?? '');
        let parsed;
        try {
          parsed = deserializeProject(text);
        } catch (err) {
          finish(
            err instanceof Error
              ? err
              : new ProjectFileError(String(err))
          );
          return;
        }
        try {
          await applyToStores(parsed, file.name, opts);
          finish(null, {
            filename: file.name,
            pageCount: parsed.pages.length,
          });
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)));
        }
      };
      reader.readAsText(file);
    });

    // Cancel handling: if the user dismisses the picker we resolve with
    // an error so callers can show a friendly message.
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!settled) finish(new Error('File selection cancelled'));
        }, 500);
      },
      { once: true }
    );

    input.click();
  });
}

async function applyToStores(
  file: ReturnType<typeof deserializeProject>,
  filename: string,
  opts: LoadOptions
): Promise<void> {
  const setPages = useDocumentStore.getState().setPages;
  const setPdfBytes = useDocumentStore.getState().setPdfBytes;
  const setPdfName = useDocumentStore.getState().setPdfName;
  const setOverlays = useDocumentStore.getState().setOverlays;
  const setTotalPages = useEditorStore.getState().setTotalPages;
  const setCurrentPage = useEditorStore.getState().setCurrentPage;
  const clearHistory = useHistoryStore.getState().clear;

  const bytes = decodeProjectPdf(file);
  setPages(file.pages);
  if (bytes) {
    setPdfBytes(bytes);
    try {
      const doc = await loadDocument(bytes);
      opts.onPdfJsDoc?.(doc);
      setTotalPages(doc.numPages);
    } catch (err) {
      console.warn('[loadProject] pdfjs could not re-open the PDF', err);
      opts.onPdfJsDoc?.(null);
      setTotalPages(file.pages.length);
    }
  } else {
    setPdfBytes(null);
    opts.onPdfJsDoc?.(null);
    setTotalPages(file.pages.length);
  }
  setOverlays(
    // 旧存档迁移:text-block 可能缺 originalBbox / lineHeight / bold / italic 字段。
    file.overlays.map((o) => {
      if (o.type !== 'text-block') return o;
      const patch: Record<string, unknown> = {};
      if (!(o as { originalBbox?: unknown }).originalBbox) {
        patch.originalBbox = { ...o.bbox };
      }
      if ((o as { lineHeight?: number }).lineHeight === undefined) {
        patch.lineHeight = 1.2;
      }
      if ((o as { bold?: boolean }).bold === undefined) {
        patch.bold = false;
      }
      if ((o as { italic?: boolean }).italic === undefined) {
        patch.italic = false;
      }
      return Object.keys(patch).length > 0 ? { ...o, ...patch } : o;
    })
  );
  setPdfName(filename.replace(/\.minipdf\.json$/i, ''));
  setCurrentPage(0);
  clearHistory();
}
