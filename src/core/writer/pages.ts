// pages.ts: re-arrange the loaded PDFDocument so that its page order,
// additions, and rotations match the editor's PageMeta[].
//
// Strategy: reload the original PDF bytes into a fresh document, then for
// each PageMeta in the desired order, either `copyPages` an original page
// (with rotation applied) or add a blank page. Inserting into `doc` in
// sequence yields the final order.
import { degrees, PDFDocument, PDFPage } from 'pdf-lib';
import type { PageMeta } from '../types';

export async function applyPages(
  doc: PDFDocument,
  pages: PageMeta[],
  originalBytes: Uint8Array
): Promise<void> {
  // Use a throwaway source document to satisfy `copyPages`.
  const source = await PDFDocument.load(originalBytes);
  const sourcePageCount = source.getPageCount();

  // 清空 doc 的现有页面:exportPdf 用 load(originalBytes) 创建 doc,
  // 已经含 N 页原始页面。不清空的话 addPages 后变 2N 页(前 N 编辑
  // + 后 N 原始重复),导出的 PDF 页面翻倍。
  while (doc.getPageCount() > 0) {
    doc.removePage(0);
  }

  for (let i = 0; i < pages.length; i += 1) {
    const meta = pages[i];
    let target: PDFPage;
    if (!meta.isBlank && meta.index >= 0 && meta.index < sourcePageCount) {
      const [copied] = await doc.copyPages(source, [meta.index]);
      // `copyPages` does not insert into `doc`; we have to do that
      // ourselves before relocating.
      target = doc.addPage(copied);
    } else {
      target = doc.addPage([meta.width, meta.height]);
    }
    if (meta.rotation !== 0) {
      target.setRotation(degrees(meta.rotation));
    }
    // `addPage` appends, so we may need to relocate the freshly-created
    // page to the requested slot.
    const currentIndex = doc.getPageCount() - 1;
    if (currentIndex !== i) {
      doc.removePage(currentIndex);
      doc.insertPage(i, target);
    }
  }
}
