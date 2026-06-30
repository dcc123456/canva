// engine/index.ts: barrel.
export * from './types';
export { pdfLibFallbackEngine } from './pdfLibFallback';
export {
  ensureEngine,
  getCachedEngine,
  resetEngineCache,
  type EngineMode,
  type EnsureEngineOptions,
} from './router';
