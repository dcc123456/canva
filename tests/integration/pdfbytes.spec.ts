import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';

describe('documentStore.setPdfBytes preserves bytes independence', () => {
  beforeEach(() => {
    useDocumentStore.setState({
      pages: [
        { id: 'page-1', index: 0, rotation: 0, width: 595, height: 842, isBlank: true },
      ],
      overlays: [],
      pdfBytes: null,
      pdfName: '',
    });
  });

  it('keeps the stored bytes equal but on a different ArrayBuffer', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    useDocumentStore.getState().setPdfBytes(original);
    const stored = useDocumentStore.getState().pdfBytes!;
    expect(Array.from(stored)).toEqual([1, 2, 3, 4, 5]);
    // pdfjs worker will detach the ArrayBuffer of any view that has been
    // transferred. To avoid that breaking later engine calls, setPdfBytes
    // must produce a *new* underlying ArrayBuffer — it must NEVER share the
    // caller's buffer.
    expect(stored.buffer).not.toBe(original.buffer);
    // But the byte ranges must agree (sanity).
    expect(stored.byteLength).toBe(original.byteLength);
  });

  it('tolerates a null set', () => {
    useDocumentStore.getState().setPdfBytes(new Uint8Array([9, 9]));
    useDocumentStore.getState().setPdfBytes(null);
    expect(useDocumentStore.getState().pdfBytes).toBeNull();
  });
});
