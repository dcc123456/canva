// serialize.spec.ts — base64 round-trip + ProjectFile serialization.
import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../../src/core/project/serialize';
import type { OverlayItem, PageMeta } from '../../src/core/types';

describe('serialize', () => {
  it('round-trips base64 bytes', () => {
    const original = new Uint8Array([0, 1, 2, 3, 254, 255, 10, 20, 30]);
    const b64 = toBase64(original);
    const back = fromBase64(b64);
    expect(back.length).toBe(original.length);
    for (let i = 0; i < original.length; i += 1) {
      expect(back[i]).toBe(original[i]);
    }
  });

  it('handles an empty buffer', () => {
    const b64 = toBase64(new Uint8Array(0));
    expect(b64).toBe('');
    expect(fromBase64(b64).length).toBe(0);
  });

  it('handles large buffers without stack overflow', () => {
    const size = 0x20000; // 128 KiB
    const buf = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) buf[i] = i & 0xff;
    const back = fromBase64(toBase64(buf));
    expect(back.length).toBe(size);
    expect(back[0]).toBe(0);
    expect(back[size - 1]).toBe((size - 1) & 0xff);
  });

  it('produces a stable JSON shape with the expected fields', () => {
    const pages: PageMeta[] = [
      { id: 'p1', index: 0, rotation: 0, width: 595, height: 842, isBlank: true },
    ];
    const overlays: OverlayItem[] = [
      {
        id: 'h1',
        pageId: 'p1',
        type: 'highlight',
        rect: { x: 1, y: 2, w: 3, h: 4 },
        color: '#FFEB3B',
        opacity: 0.4,
      },
    ];
    const json = JSON.stringify({
      version: 2,
      pdf: toBase64(new Uint8Array([1, 2, 3])),
      pages,
      overlays,
      createdAt: '2026-06-29T00:00:00Z',
    });
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(2);
    expect(parsed.pages[0].width).toBe(595);
    expect(parsed.overlays[0].type).toBe('highlight');
    expect(parsed.overlays[0].color).toBe('#FFEB3B');
  });
});