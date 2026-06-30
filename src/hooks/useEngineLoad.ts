// hooks/useEngineLoad.ts
//
// Synchronises the engine-loading state with `engineStore` and exposes
// imperative methods for the UI to call. Progress is propagated to the
// store so `LoadingOverlay` can render without the caller having to
// wire its own `onProgress` callback.
import { useCallback, useState } from 'react';
import { useEngineStore } from '../store/engineStore';
import { ensureEngine, type EngineInterface } from '../core/engine';

export interface UseEngineLoadResult {
  loading: boolean;
  error: string | null;
  ready: boolean;
  progress: number;
  load: (mode?: 'edit' | 'render') => Promise<EngineInterface | null>;
  dismissError: () => void;
}

export function useEngineLoad(): UseEngineLoadResult {
  const loading = useEngineStore((s) => s.mupdfLoading);
  const error = useEngineStore((s) => s.mupdfError);
  const ready = useEngineStore((s) => s.mupdfReady);
  const currentEngine = useEngineStore((s) => s.currentEngine);
  const setProgress = useState<number>(0);
  const [progress, _setProgress] = setProgress;

  const load = useCallback(
    async (mode: 'edit' | 'render' = 'edit') => {
      _setProgress(0);
      try {
        const engine = await ensureEngine(mode, {
          onProgress: (p) => _setProgress(p),
        });
        return engine;
      } catch (err) {
        console.error('[useEngineLoad] load failed:', err);
        return null;
      }
    },
    []
  );

  const dismissError = useCallback(() => {
    useEngineStore.getState().setMupdfError(null);
  }, []);

  // `ready` is true once the store marks itself ready OR the cached engine
  // exists (i.e. we have something usable, even if it's the fallback).
  const effectiveReady = ready || currentEngine !== 'pdfjs' || !loading;

  return {
    loading,
    error,
    ready: effectiveReady,
    progress,
    load,
    dismissError,
  };
}
