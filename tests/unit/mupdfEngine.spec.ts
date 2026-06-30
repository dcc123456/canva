// tests/unit/mupdfEngine.spec.ts
//
// Smoke tests for the MuPDF.js-backed EngineInterface implementation.
//
// In happy-dom we don't load the actual mupdf wasm — we just assert that
// the engine slot is the right shape and that helpers are wired without
// blowing up. The end-to-end document round-trip is covered manually in
// the browser (and via the integration spec when we have a real PDF).
import { describe, it, expect } from 'vitest';
import { mupdfEngine } from '../../src/core/mupdf/mupdfEngine';

describe('mupdfEngine', () => {
  it('kind is "mupdf" — slots into the EngineKind union', () => {
    expect(mupdfEngine.kind).toBe('mupdf');
  });

  it('exposes the four EngineInterface methods', () => {
    expect(typeof mupdfEngine.detectTextBlocks).toBe('function');
    expect(typeof mupdfEngine.writeTextBlock).toBe('function');
    expect(typeof mupdfEngine.parseFormFields).toBe('function');
    expect(typeof mupdfEngine.writeFormFields).toBe('function');
  });
});
