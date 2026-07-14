import { create } from 'zustand';
import type { Tool } from '../core/types';

export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export interface EditorState {
  currentPageIndex: number;
  zoom: number;
  tool: Tool;
  totalPages: number;
  selectedOverlayId: string | null;

  setCurrentPage: (index: number) => void;
  setZoom: (zoom: number) => void;
  setTool: (tool: Tool) => void;
  setTotalPages: (n: number) => void;
  setSelectedOverlayId: (id: string | null) => void;
  nextPage: () => void;
  prevPage: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

function findClosestZoom(target: number, base: readonly number[] = ZOOM_LEVELS): number {
  let best: number = base[0];
  let bestDiff = Math.abs(target - best);
  for (const z of base) {
    const d = Math.abs(target - z);
    if (d < bestDiff) {
      best = z;
      bestDiff = d;
    }
  }
  return best;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  currentPageIndex: 0,
  zoom: 1,
  tool: 'edit-text',
  totalPages: 0,
  selectedOverlayId: null,

  setCurrentPage: (index) =>
    set(() => ({
      currentPageIndex: Math.max(0, Math.min(Math.max(0, get().totalPages - 1), index)),
    })),

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(8, zoom)) }),

  setTool: (tool) => set({ tool }),

  setTotalPages: (n) => set({ totalPages: Math.max(0, n) }),

  setSelectedOverlayId: (id) => set({ selectedOverlayId: id }),

  nextPage: () => {
    const { currentPageIndex, totalPages } = get();
    set({ currentPageIndex: Math.min(totalPages - 1, currentPageIndex + 1) });
  },

  prevPage: () => {
    const { currentPageIndex } = get();
    set({ currentPageIndex: Math.max(0, currentPageIndex - 1) });
  },

  zoomIn: () => {
    const current = get().zoom;
    const next = findClosestZoom(current + 0.25);
    set({ zoom: next });
  },

  zoomOut: () => {
    const current = get().zoom;
    const next = findClosestZoom(current - 0.25);
    set({ zoom: next });
  },
}));
