// Pen settings store (F6): color and stroke width for the draw tool.
import { create } from 'zustand';

export interface PenState {
  color: string;
  width: number;
  setColor: (c: string) => void;
  setWidth: (w: number) => void;
}

export const usePenStore = create<PenState>((set) => ({
  color: '#111827',
  width: 2,
  setColor: (color) => set({ color }),
  setWidth: (width) => set({ width: Math.max(0.5, Math.min(20, width)) }),
}));
