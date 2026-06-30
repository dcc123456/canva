// Global setup for vitest. Loads the jest-dom matchers and configures
// pdfjs-dist to run in the Node-compatible legacy mode.
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// The main pdfjs-dist ESM entry expects a real Web Worker. In a Node
// test environment we point the import at the `legacy` build which has
// a fake-worker implementation and runs everything on the main thread.
vi.mock('pdfjs-dist', async () => {
  const legacy = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const GlobalWorkerOptions = legacy.GlobalWorkerOptions as {
    workerSrc: string;
  };
  // The fake worker only needs a syntactically valid URL to a local
  // file; we point it at the legacy worker shipped with the package.
  const workerPath = resolve(
    fileURLToPath(import.meta.url),
    '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
  );
  GlobalWorkerOptions.workerSrc = fileURLToPath(
    `file://${workerPath.replace(/\\/g, '/')}`
  );
  return legacy;
});

// The app's loader module reads the worker URL via Vite's `?url` import
// and writes it back into GlobalWorkerOptions. Stub it to a harmless
// non-empty string so that side-effect doesn't blank out the workerSrc
// we just set in the pdfjs-dist mock above.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'pdfjs-dist/legacy/build/pdf.worker.mjs',
}));

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({
  default: 'pdfjs-dist/legacy/build/pdf.worker.mjs',
}));