// coords.spec.ts — verifies the symmetry of screen ↔ PDF conversions.
import { describe, expect, it } from 'vitest';
import {
  pdfRectToScreen,
  pdfToScreen,
  screenRectToPdf,
  screenToPdf,
} from '../../src/utils/coordinates';

describe('coordinates', () => {
  it('round-trips a point through screen and PDF space', () => {
    const zoom = 1.5;
    const original = { x: 120, y: 240 };
    const pdf = screenToPdf(original, zoom);
    const back = pdfToScreen(pdf, zoom);
    expect(back.x).toBeCloseTo(original.x, 6);
    expect(back.y).toBeCloseTo(original.y, 6);
  });

  it('divides by zoom on the way down', () => {
    expect(screenToPdf({ x: 100, y: 50 }, 2)).toEqual({ x: 50, y: 25 });
  });

  it('multiplies by zoom on the way up', () => {
    expect(pdfToScreen({ x: 50, y: 25 }, 2)).toEqual({ x: 100, y: 50 });
  });

  it('round-trips a rectangle', () => {
    const zoom = 0.75;
    const r = { x: 12.5, y: 7.25, w: 200, h: 100 };
    const down = screenRectToPdf(r, zoom);
    const up = pdfRectToScreen(down, zoom);
    expect(up.x).toBeCloseTo(r.x, 6);
    expect(up.y).toBeCloseTo(r.y, 6);
    expect(up.w).toBeCloseTo(r.w, 6);
    expect(up.h).toBeCloseTo(r.h, 6);
  });

  it('handles 1:1 zoom as identity', () => {
    const p = { x: 42, y: 17 };
    expect(screenToPdf(p, 1)).toEqual(p);
    expect(pdfToScreen(p, 1)).toEqual(p);
  });
});