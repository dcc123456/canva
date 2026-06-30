// exportPdf.ts: serialize the current editor state to a PDF file and
// trigger a browser download.
import { PDFDocument } from 'pdf-lib';
import { useDocumentStore } from '../../store/documentStore';
import { applyPages } from '../../core/writer/pages';
import { flattenOverlays } from '../../core/writer/flatten';
import { downloadBlob } from '../../utils/download';
import { ensureEngine, getCachedEngine } from '../../core/engine';
import type {
  FormFieldItem,
  TextBlockItem,
} from '../../core/types';

export interface ExportProgress {
  phase: 'load' | 'pages' | 'engine' | 'flatten' | 'save' | 'done';
}

export interface ExportResult {
  filename: string;
  bytes: number;
}

export async function exportPdf(
  onProgress?: (p: ExportProgress) => void
): Promise<ExportResult> {
  const { pages, overlays, pdfBytes, pdfName } = useDocumentStore.getState();
  const safeName = (pdfName || 'document').replace(/\.pdf$/i, '');
  const filename = `${safeName}-edited.pdf`;

  onProgress?.({ phase: 'load' });

  let doc: PDFDocument;
  let originalBytes: Uint8Array;
  if (pdfBytes) {
    // Copy the bytes so pdf-lib can mutate the buffer freely.
    originalBytes = pdfBytes.slice();
    doc = await PDFDocument.load(originalBytes);
  } else {
    // Brand-new blank document: build a fresh PDFDocument. The pages
    // produced here are also "blank" in the editor's sense, so
    // applyPages just adds them at the right sizes.
    doc = await PDFDocument.create();
    originalBytes = await doc.save();
  }

  onProgress?.({ phase: 'pages' });
  await applyPages(doc, pages, originalBytes);

  onProgress?.({ phase: 'engine' });
  // Step 1: text-block edits whose engine has NOT yet destroyed their
  // original page text object. Both `mupdf` and `pdfium` sources have
  // already been written back into store.pdfBytes at commit time, so
  // we skip them here. Only `pdflib-overlay` (or future un-committed
  // blocks) needs a final round-trip through the engine.
  const pendingTextBlocks = overlays.filter(
    (o): o is TextBlockItem =>
      o.type === 'text-block' &&
      o.text !== o.originalText &&
      o.source !== 'pdfium' &&
      o.source !== 'mupdf'
  );
  if (pendingTextBlocks.length > 0) {
    const engine = getCachedEngine() ?? (await ensureEngine('edit'));
    if (engine) {
      for (const b of pendingTextBlocks) {
        const pageIndex = pages.findIndex((p) => p.id === b.pageId);
        if (pageIndex < 0) continue;
        try {
          const result = await engine.writeTextBlock({
            pageIndex,
            blockId: b.id,
            newText: b.text,
            block: {
              id: b.id,
              bbox: b.bbox,
              text: b.originalText,
              font: b.font,
              fontSize: b.fontSize,
              color: b.color,
            },
            pdfBytes: originalBytes,
          });
          originalBytes = result.bytes;
        } catch (err) {
          console.warn(
            `[exportPdf] engine writeTextBlock failed for ${b.id}; falling back to overlay repaint:`,
            err
          );
        }
      }
      doc = await PDFDocument.load(originalBytes);
    }
  }

  // Step 2: form-field values are written into the AcroForm (if any).
  const formFields = overlays.filter(
    (o): o is FormFieldItem => o.type === 'form-field'
  );
  if (formFields.length > 0) {
    const engine = getCachedEngine() ?? (await ensureEngine('edit'));
    if (engine) {
      try {
        const result = await engine.writeFormFields({
          pdfBytes: originalBytes,
          values: formFields.map((f) => ({
            id: f.id,
            pageIndex: pages.findIndex((p) => p.id === f.pageId),
            fieldName: f.fieldName,
            kind: f.kind,
            bbox: f.bbox,
            value: f.value,
            options: f.options,
          })),
        });
        originalBytes = result.bytes;
        doc = await PDFDocument.load(originalBytes);
      } catch (err) {
        console.warn('[exportPdf] writeFormFields failed:', err);
      }
    }
  }

  onProgress?.({ phase: 'flatten' });
  // text-block overlays are now drawn here: their original PDF objects
  // were destroyed upstream (pdfium) or covered here (pdflib-overlay),
  // and we just paint the new text at the same baseline.
  // form-field overlays still go through the engine (AcroForm writes).
  const flattenList = overlays.filter((o) => o.type !== 'form-field');
  await flattenOverlays(doc, flattenList, pages);

  onProgress?.({ phase: 'save' });
  const bytes = await doc.save();
  downloadBlob(bytes, filename, 'application/pdf');
  onProgress?.({ phase: 'done' });
  return { filename, bytes: bytes.byteLength };
}
