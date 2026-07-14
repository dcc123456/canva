// Engine store: tracks the current PDF engine (pdfjs vs mupdf) and its readiness.
// Also holds transient detection UI state (progress bar, status message) so
// that ToolSidebar (which runs detection) and TopBar (which renders the
// LoadingOverlay + status text) can communicate without prop threading.
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

  // Detection UI state -- set by ToolSidebar.runEngineDetection, read by TopBar.
  detectionVisible: boolean;
  detectionProgress: number;
  detectionLabel: string;
  engineStatusMessage: string | null;
  setDetectionVisible: (v: boolean) => void;
  setDetectionProgress: (p: number) => void;
  setDetectionLabel: (l: string) => void;
  setEngineStatusMessage: (msg: string | null) => void;
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

  detectionVisible: false,
  detectionProgress: 0,
  detectionLabel: '初始化',
  engineStatusMessage: null,
  setDetectionVisible: (v) => set({ detectionVisible: v }),
  setDetectionProgress: (p) => set({ detectionProgress: p }),
  setDetectionLabel: (l) => set({ detectionLabel: l }),
  setEngineStatusMessage: (msg) => set({ engineStatusMessage: msg }),
}));
