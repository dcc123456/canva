// Engine store: tracks the current PDF engine (pdfjs vs mupdf) and its readiness.
import { create } from 'zustand';

export type EngineName = 'pdfjs' | 'mupdf' | 'pdfium';

export interface EngineState {
  mupdfReady: boolean;
  mupdfLoading: boolean;
  mupdfError: string | null;
  currentEngine: EngineName;
  setMupdfReady: (ready: boolean) => void;
  setMupdfLoading: (loading: boolean) => void;
  setMupdfError: (err: string | null) => void;
  setCurrentEngine: (engine: EngineName) => void;
}

export const useEngineStore = create<EngineState>((set) => ({
  mupdfReady: false,
  mupdfLoading: false,
  mupdfError: null,
  currentEngine: 'pdfjs',
  setMupdfReady: (ready) => set({ mupdfReady: ready, mupdfLoading: false }),
  setMupdfLoading: (loading) => set({ mupdfLoading: loading }),
  setMupdfError: (err) => set({ mupdfError: err, mupdfLoading: false, mupdfReady: !err }),
  setCurrentEngine: (engine) => set({ currentEngine: engine }),
}));
