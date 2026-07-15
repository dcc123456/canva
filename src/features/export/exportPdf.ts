// exportPdf.ts: 导出管线(MuPDF redaction + 矢量保留 + 编辑分离)。
//
// 架构:
//   1. 加载干净的原 pdfBytes
//   2. applyMupdfRedactions (MuPDF 字节级删字,替代白底覆盖)
//   3. PDFDocument.load(redactedBytes) + applyPages (copyPages + 旋转)
//   4. applyTextBlockRedraws (画新字;redacted=true 跳过白底,false 走白底兜底)
//   5. flattenOverlays (非 text-block 的 overlay: highlight/note/
//      text/image/drawing)
//   6. createFormFields (pdf-lib form API 重建 AcroForm)
//   7. save -> 下载
//
// 关键改进:
//   * MuPDF applyRedactions(false,0,0,0) 字节级删字,不再有白底色块
//   * redaction 失败时自动降级为白底覆盖(redacted=false 兜底)
//   * 原 PDF 矢量保留,未编辑文字仍可搜索/复制
import { PDFDocument } from 'pdf-lib';
import { useDocumentStore } from '../../store/documentStore';
import { applyPages } from '../../core/writer/pages';
import { flattenOverlays } from '../../core/writer/flatten';
import { applyTextBlockRedraws } from '../../core/writer/textBlockEdits';
import { applyMupdfRedactions, type RedactEdit } from '../../core/writer/redact';
import { createFormFields } from '../../core/writer/formFields';
import { loadCjkFontBytes } from '../../core/writer/cjkFont';
import { downloadBlob } from '../../utils/download';
import type {
  FormFieldItem,
  TextBlockItem,
} from '../../core/types';

export interface ExportProgress {
  phase: 'load' | 'redact' | 'pages' | 'textedits' | 'flatten' | 'forms' | 'save' | 'done';
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

  // 提前计算编辑块列表(redaction 和重画都需要)。
  const editedTextBlocks = overlays.filter(
    (o): o is TextBlockItem =>
      o.type === 'text-block' &&
      (o.text !== o.originalText ||
        o.bbox.x !== o.originalBbox.x ||
        o.bbox.y !== o.originalBbox.y ||
        o.bbox.w !== o.originalBbox.w ||
        o.bbox.h !== o.originalBbox.h ||
        // Styling changed: segments differ from detection-time snapshot.
        (o.originalSegments != null
          ? JSON.stringify(o.segments ?? []) !==
            JSON.stringify(o.originalSegments)
          : o.segments != null && o.segments.length > 0))
  );

  let doc: PDFDocument;
  let workingBytes: Uint8Array;
  let redacted = false;
  if (pdfBytes) {
    const cleanBytes = pdfBytes.slice();

    // Phase: redact -- MuPDF 字节级删字(替代白底覆盖)。
    if (editedTextBlocks.length > 0) {
      onProgress?.({ phase: 'redact' });
      const redactEdits: RedactEdit[] = [];
      for (const block of editedTextBlocks) {
        const editorPageIndex = pages.findIndex((p) => p.id === block.pageId);
        if (editorPageIndex < 0) continue;
        const meta = pages[editorPageIndex];
        if (meta.isBlank || meta.index < 0) continue;
        redactEdits.push({
          pageIndex: meta.index,
          originalBbox: block.originalBbox,
        });
      }
      const result = await applyMupdfRedactions(cleanBytes, redactEdits);
      workingBytes = result.bytes;
      redacted = result.redacted;
    } else {
      workingBytes = cleanBytes;
      redacted = true;
    }

    doc = await PDFDocument.load(workingBytes);
  } else {
    // Brand-new blank document.
    doc = await PDFDocument.create();
    workingBytes = await doc.save();
    redacted = true;
  }

  onProgress?.({ phase: 'pages' });
  await applyPages(doc, pages, workingBytes);

  // Step 1: 对已编辑 text-block 重画新字。
  // redacted=true: MuPDF 已删原字,只画新字。
  // redacted=false: 走白底覆盖 + 重画(兜底)。
  onProgress?.({ phase: 'textedits' });
  if (editedTextBlocks.length > 0) {
    // 预加载 CJK 字体:如果有编辑过的 text-block 含中文,需要 CJK 字体。
    const hasCjk = editedTextBlocks.some((b) =>
      b.text.split('').some((ch) => (ch.codePointAt(0) ?? 0) > 0x7e)
    );
    if (hasCjk) {
      await loadCjkFontBytes();
    }
    await applyTextBlockRedraws({
      doc,
      originalBytes: workingBytes,
      pages,
      textBlocks: editedTextBlocks,
      redacted,
    });
  }

  // Step 2: 非 text-block / 非 form-field 的 overlay -> flatten。
  // (text-block 已由 applyTextBlockRedraws 处理,form-field 由下一步处理)
  onProgress?.({ phase: 'flatten' });
  const flattenList = overlays.filter(
    (o) => o.type !== 'form-field'
  );
  await flattenOverlays(doc, flattenList, pages);

  // Step 3: 表单字段 -> 用 pdf-lib form API 重建 AcroForm。
  onProgress?.({ phase: 'forms' });
  const formFields = overlays.filter(
    (o): o is FormFieldItem => o.type === 'form-field'
  );
  if (formFields.length > 0) {
    await createFormFields(doc, pages, formFields);
  }

  onProgress?.({ phase: 'save' });
  const bytes = await doc.save();
  downloadBlob(bytes, filename, 'application/pdf');
  onProgress?.({ phase: 'done' });
  return { filename, bytes: bytes.byteLength };
}
