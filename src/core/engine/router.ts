// engine/router.ts
//
// 决定 `EngineInterface` 实现的选择策略。
//
//   * 'render' 模式总是返回 pdfLibFallback (实际渲染由 pdfjs 直接做)。
//   * 'edit'   模式按优先级试探,首次解析成功后会被缓存:
//
//        1. MuPDF.js       —— 真正的字节级删字 (Redact + applyRedactions)。
//                              这是我们想用的"直接编辑原文"路径。
//        2. PDFium (旧路径)—— 作为备用,通过 FPDFPageObj_Destroy 删字 +
//                              重画;只有在 mupdf wasm 加载失败时才会启用。
//        3. pdf-lib overlay—— 最末兜底,白底覆盖 + 重画,非字节级。
//
// 解析结果会被缓存,后续 `ensureEngine('edit')` 调用立即返回。
import { useEngineStore } from '../../store/engineStore';
import { pdfLibFallbackEngine } from './pdfLibFallback';
import { loadPdfium, pdfiumEngine } from '../pdfium/pdfiumEngine';
import { loadMupdf } from '../mupdf/loader';
import { mupdfEngine } from '../mupdf/mupdfEngine';
import type { EngineInterface } from './types';

export type EngineMode = 'edit' | 'render';

let cached: EngineInterface | null = null;
let pendingEnsure: Promise<EngineInterface> | null = null;

export type EnsureEngineOptions = {
  onProgress?: (progress: number, label?: string) => void;
};

async function tryMupdf(
  onProgress?: (p: number, label?: string) => void
): Promise<EngineInterface | null> {
  try {
    await loadMupdf((p, label) => onProgress?.(Math.min(0.6, p * 0.6), label));
    onProgress?.(0.7, 'mupdf ready');
    return mupdfEngine;
  } catch (err) {
    console.warn('[router] mupdf engine unavailable:', err);
    return null;
  }
}

async function tryPdfium(
  onProgress?: (p: number, label?: string) => void
): Promise<EngineInterface | null> {
  try {
    await loadPdfium((p, label) =>
      onProgress?.(Math.min(0.6, 0.6 + p * 0.3), label)
    );
    onProgress?.(0.9, 'pdfium ready');
    return pdfiumEngine;
  } catch (err) {
    console.warn('[router] pdfium engine unavailable:', err);
    return null;
  }
}

export function ensureEngine(
  mode: EngineMode,
  options: EnsureEngineOptions = {}
): Promise<EngineInterface> {
  if (mode === 'render') {
    return Promise.resolve(pdfLibFallbackEngine);
  }
  if (cached) return Promise.resolve(cached);
  if (pendingEnsure) return pendingEnsure;

  const store = useEngineStore.getState();
  store.setMupdfLoading(true);
  store.setMupdfError(null);
  pendingEnsure = (async () => {
    // 优先级 1:MuPDF.js (真删字)
    let candidate = await tryMupdf(options.onProgress);
    if (!candidate) {
      // 优先级 2:旧的 PDFium 路径
      candidate = await tryPdfium(options.onProgress);
    }
    const engine: EngineInterface = candidate ?? pdfLibFallbackEngine;
    if (engine.kind === 'mupdf') {
      store.setMupdfReady(true);
      store.setCurrentEngine('mupdf');
    } else if (engine.kind === 'pdfium') {
      store.setMupdfReady(true);
      store.setCurrentEngine('pdfium');
    } else {
      store.setCurrentEngine('pdfjs');
    }
    options.onProgress?.(1, 'engine ready');
    cached = engine;
    return engine;
  })()
    .catch((err) => {
      store.setMupdfError(String(err));
      cached = pdfLibFallbackEngine;
      store.setCurrentEngine('pdfjs');
      return cached;
    })
    .finally(() => {
      pendingEnsure = null;
      store.setMupdfLoading(false);
    });
  return pendingEnsure;
}

export function getCachedEngine(): EngineInterface | null {
  return cached;
}

export function resetEngineCache(): void {
  cached = null;
}
