// detectTextBlocks.spec.ts — verifies the pdfLibFallback engine groups
// the same y-coordinate items into a single block. We build a PDF with
// two lines ("Hello" and "World") and assert that exactly 2 blocks are
// returned.
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { pdfLibFallbackEngine } from '../../src/core/engine/pdfLibFallback';

async function makeHelloWorldPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Hello', { x: 50, y: 750, size: 24, font, color: rgb(0, 0, 0) });
  page.drawText('World', { x: 50, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  return doc.save();
}

describe('detectTextBlocks (pdfLibFallback)', () => {
  it('detects 2 blocks for a 2-line PDF', async () => {
    const bytes = await makeHelloWorldPdf();
    const blocks = await pdfLibFallbackEngine.detectTextBlocks({
      pageIndex: 0,
      pdfBytes: bytes,
    });
    expect(blocks.length).toBe(2);
    // The two lines should be "Hello" and "World" (order may vary by sort).
    const texts = blocks.map((b) => b.text).sort();
    expect(texts).toEqual(['Hello', 'World']);
  });

  it('returns an empty array for a page with no text', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const bytes = await doc.save();
    const blocks = await pdfLibFallbackEngine.detectTextBlocks({
      pageIndex: 0,
      pdfBytes: bytes,
    });
    expect(blocks).toEqual([]);
  });

  it('groups two same-baseline glyphs into a single block', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('Foo', { x: 50, y: 700, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText('Bar', { x: 80, y: 700, size: 12, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();
    const blocks = await pdfLibFallbackEngine.detectTextBlocks({
      pageIndex: 0,
      pdfBytes: bytes,
    });
    expect(blocks.length).toBe(1);
    expect(blocks[0].text).toMatch(/Foo.*Bar/);
  });
});