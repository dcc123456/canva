// export-pages.spec.ts — verifies the resulting PDF after applyPages
// has the same number of pages as the requested PageMeta[].
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyPages } from '../../src/core/writer/pages';
import type { PageMeta } from '../../src/core/types';

async function makeSamplePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    doc.addPage([595, 842]);
  }
  return doc.save();
}

describe('applyPages', () => {
  it('produces a PDF with the same number of pages as the PageMeta list', async () => {
    const originalBytes = await makeSamplePdf(3);
    const outDoc = await PDFDocument.create();
    const pages: PageMeta[] = [
      { id: 'a', index: 0, rotation: 0, width: 595, height: 842 },
      { id: 'b', index: 1, rotation: 0, width: 595, height: 842 },
      { id: 'c', index: 2, rotation: 0, width: 595, height: 842 },
    ];
    await applyPages(outDoc, pages, originalBytes);
    const outBytes = await outDoc.save();
    const reloaded = await PDFDocument.load(outBytes);
    expect(reloaded.getPageCount()).toBe(pages.length);
  });

  it('appends blank pages when there are more PageMetas than source pages', async () => {
    const originalBytes = await makeSamplePdf(1);
    const outDoc = await PDFDocument.create();
    const pages: PageMeta[] = [
      { id: 'a', index: 0, rotation: 0, width: 595, height: 842 },
      { id: 'b', index: -1, rotation: 0, width: 400, height: 600, isBlank: true },
    ];
    await applyPages(outDoc, pages, originalBytes);
    const outBytes = await outDoc.save();
    const reloaded = await PDFDocument.load(outBytes);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it('drops pages when there are fewer PageMetas than source pages', async () => {
    const originalBytes = await makeSamplePdf(3);
    const outDoc = await PDFDocument.create();
    const pages: PageMeta[] = [
      { id: 'only', index: 1, rotation: 0, width: 595, height: 842 },
    ];
    await applyPages(outDoc, pages, originalBytes);
    const outBytes = await outDoc.save();
    const reloaded = await PDFDocument.load(outBytes);
    expect(reloaded.getPageCount()).toBe(1);
  });
});