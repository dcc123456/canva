// exportPdf.ts: 重构后的单一导出管线。
//
// 架构:矢量保留 + 编辑分离 + 导出统一管线。
//   1. 加载干净的原 pdfBytes(编辑过程从未改写) -> PDFDocument
//   2. applyPages (copyPages + 旋转,保留页面管理)
//   3. applyTextBlockEdits (对已编辑的 text-block: MuPDF 字符 quad
//      白底 + pdf-lib 重画新字)
//   4. flattenOverlays (非 text-block 的 overlay: highlight/note/
//      text/image/drawing)
//   5. createFormFields (pdf-lib form API 重建 AcroForm)
//   6. save -> 下载
//
// 关键改进:
//   * 画布与导出用同一套"原字 + 白底 + 新字"模型,不再有两套路径不一致
//   * 没有 source 字段分叉,没有 pendingTextBlocks 的 engine 往返
//   * 原 PDF 矢量保留,未编辑文字仍可搜索/复制
import { PDFDocument } from 'pdf-lib';
import { useDocumentStore } from '../../store/documentStore';
import { applyPages } from '../../core/writer/pages';
import { flattenOverlays } from '../../core/writer/flatten';
import { applyTextBlockEdits } from '../../core/writer/textBlockEdits';
import { createFormFields } from '../../core/writer/formFields';
import { loadCjkFontBytes } from '../../core/writer/cjkFont';
import { downloadBlob } from '../../utils/download';
import type {
  FormFieldItem,
  TextBlockItem,
} from '../../core/types';

export interface ExportProgress {
  phase: 'load' | 'pages' | 'textedits' | 'flatten' | 'forms' | 'save' | 'done';
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
    // pdfBytes 是干净的原 PDF -- 编辑过程从不改写它。
    // 用 load() 保留完整 PDF 上下文(字体/资源字典),applyPages
    // 内部会先清空 doc 的页面再 copyPages,避免 2N 页重复。
    originalBytes = pdfBytes.slice();
    doc = await PDFDocument.load(originalBytes);
  } else {
    // Brand-new blank document.
    doc = await PDFDocument.create();
    originalBytes = await doc.save();
  }

  onProgress?.({ phase: 'pages' });
  await applyPages(doc, pages, originalBytes);

  // Step 1: 对已编辑/移动/改样式的 text-block 统一应用(字符级白底 + 重画新字)。
  // 未编辑且未移动且未改样式的 text-block 原字已在 PDF 里,不需要处理。
  // segments 非空表示用户在 contenteditable 里改过富文本样式(粗体/斜体/颜色),
  // 即使文字内容没变也需要白底覆盖原字 + 重画带样式的新字。
  onProgress?.({ phase: 'textedits' });
  const editedTextBlocks = overlays.filter(
    (o): o is TextBlockItem =>
      o.type === 'text-block' &&
      (o.text !== o.originalText ||
        o.bbox.x !== o.originalBbox.x ||
        o.bbox.y !== o.originalBbox.y ||
        o.bbox.w !== o.originalBbox.w ||
        o.bbox.h !== o.originalBbox.h ||
        (o.segments != null && o.segments.length > 0))
  );
  if (editedTextBlocks.length > 0) {
    // 预加载 CJK 字体:如果有编辑过的 text-block 含中文,需要 CJK 字体。
    // 重构后编辑不再调引擎,CDN 字体不会在编辑时被预缓存,所以这里显式
    // 预加载。如果全部 CDN 不可达,loadCjkFontBytes 返回 null,中文会降级
    // 为 '?'(而非空白)。
    const hasCjk = editedTextBlocks.some((b) =>
      b.text.split('').some((ch) => (ch.codePointAt(0) ?? 0) > 0x7e)
    );
    if (hasCjk) {
      await loadCjkFontBytes();
    }
    await applyTextBlockEdits({
      doc,
      originalBytes,
      pages,
      textBlocks: editedTextBlocks,
    });
  }

  // Step 2: 非 text-block / 非 form-field 的 overlay -> flatten。
  // (text-block 已由 applyTextBlockEdits 处理,form-field 由下一步处理)
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
