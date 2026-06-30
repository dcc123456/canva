import { describe, it, expect } from 'vitest';
import { readUtf16LE, type PdfiumLike } from '../../src/core/pdfium/helpers';

function mkMod(bytes: Uint8Array): PdfiumLike {
  // ArrayBuffer needs to be 4-byte aligned so Uint32Array can wrap it.
  const size = Math.max(16, bytes.byteLength + 4);
  const heap = new ArrayBuffer(Math.ceil(size / 4) * 4);
  const u8 = new Uint8Array(heap);
  u8.set(bytes, 0);
  return {
    pdfium: {
      HEAPU8: u8,
      HEAPU32: new Uint32Array(heap),
      HEAPF32: new Float32Array(heap),
      UTF8ToString: () => '',
      stringToUTF8: () => 0,
      wasmExports: {
        malloc: () => 0,
        free: () => undefined,
      },
    },
  } as unknown as PdfiumLike;
}

describe('readUtf16LE', () => {
  it('decodes ASCII correctly', () => {
    const bytes = new Uint8Array([0x41, 0x00]); // 'A' in UTF-16LE
    const got = readUtf16LE(mkMod(bytes), 0, bytes.byteLength);
    expect(got).toBe('A');
  });

  it('decodes full-width "你" (CJK round-trip from the failing stack trace)', () => {
    // The original bug surfaced with `Invalid UTF-8 leading byte 0xa1`
    // because PDFium writes UTF-16LE and we were handing it to UTF8ToString.
    // 你 = U+4F60 → low byte 0x60, high byte 0x4F → [0x60, 0x4F].
    const bytes = new Uint8Array([0x60, 0x4f]);
    const got = readUtf16LE(mkMod(bytes), 0, bytes.byteLength);
    expect(got).toBe('你');
  });

  it('strips trailing UTF-16LE NUL terminator', () => {
    const bytes = new Uint8Array([0x41, 0x00, 0x00, 0x00]);
    const got = readUtf16LE(mkMod(bytes), 0, bytes.byteLength);
    expect(got).toBe('A');
  });

  it('returns empty string for empty buffer or zero ptr', () => {
    const mod = mkMod(new Uint8Array());
    expect(readUtf16LE(mod, 0, 0)).toBe('');
    expect(readUtf16LE(mod, 0, 0)).toBe('');
  });

  it('does not throw on full-width characters', () => {
    const src = '前后端工程师 / 你好世界';
    const bytes = new Uint8Array(src.length * 2);
    for (let i = 0; i < src.length; i += 1) {
      const code = src.charCodeAt(i);
      bytes[i * 2] = code & 0xff;
      bytes[i * 2 + 1] = (code >> 8) & 0xff;
    }
    const got = readUtf16LE(mkMod(bytes), 0, bytes.byteLength);
    expect(got).toBe(src);
  });
});
