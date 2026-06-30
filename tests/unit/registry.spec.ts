// registry.spec.ts — verifies the built-in templates generate valid PDFs.
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  BUILTIN_TEMPLATES,
  generateBuiltinPdf,
  getBuiltinTemplate,
} from '../../src/core/templates/registry';

describe('builtin template registry', () => {
  it('exposes 5 templates', () => {
    expect(BUILTIN_TEMPLATES.length).toBe(5);
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual([
      'blank-a4',
      'blank-letter',
      'resume-modern',
      'invoice',
      'meeting-notes',
    ]);
  });

  it('finds a template by id', () => {
    expect(getBuiltinTemplate('blank-a4')?.name).toBe('A4 空白');
    expect(getBuiltinTemplate('does-not-exist')).toBeUndefined();
  });

  it('generates a single-page PDF for blank-a4', async () => {
    const bytes = await generateBuiltinPdf('blank-a4');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(595, 0);
    expect(page.getHeight()).toBeCloseTo(842, 0);
  });

  it('generates a single-page PDF for blank-letter (612 x 792)', async () => {
    const bytes = await generateBuiltinPdf('blank-letter');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(612, 0);
    expect(page.getHeight()).toBeCloseTo(792, 0);
  });

  it('generates a valid PDF for resume-modern', async () => {
    const bytes = await generateBuiltinPdf('resume-modern');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('generates a valid PDF for invoice', async () => {
    const bytes = await generateBuiltinPdf('invoice');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('generates a valid PDF for meeting-notes', async () => {
    const bytes = await generateBuiltinPdf('meeting-notes');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('throws for unknown template ids', async () => {
    await expect(generateBuiltinPdf('nope')).rejects.toThrow(/Unknown/);
  });
});