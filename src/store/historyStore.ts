// historyStore.ts: keeps two stacks of `{ forward, inverse }` patch tuples.
// On `undo()` we apply the inverse patches of the most-recent entry and
// move the entry onto the redo stack; on `redo()` we do the opposite.
//
// The document store pushes both the forward and inverse patches of every
// change here. `applyPatches` from Immer is what rehydrates the document
// state during undo / redo.
import { create } from 'zustand';
import { applyPatches, enablePatches, type Patch } from 'immer';
import { useDocumentStore } from './documentStore';

enablePatches();

export interface HistoryEntry {
  forward: Patch[];
  inverse: Patch[];
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];

  /** Record a state change. */
  push: (entry: HistoryEntry) => void;

  /** Pop the most-recent entry, apply its inverse patches, and remember
   *  it for redo. Returns `false` when there is nothing to undo. */
  undo: () => boolean;

  /** Pop the most-recent undone entry, re-apply its forward patches, and
   *  remember it for undo. Returns `false` when there is nothing to redo. */
  redo: () => boolean;

  clear: () => void;
}

/**
 * Apply a list of patches to the document store by passing a new state to
 * zustand's setter. We only need to track the four fields managed by
 * `documentStore`; helper fields (actions) are inherited from the current
 * state.
 */
function applyToDocument(patches: Patch[]): void {
  if (patches.length === 0) return;
  useDocumentStore.setState((state) => {
    const next = applyPatches(
      {
        pages: state.pages,
        overlays: state.overlays,
        pdfBytes: state.pdfBytes,
        pdfName: state.pdfName,
      },
      patches
    );
    return next as Partial<typeof state>;
  });
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  push: (entry) => {
    if (entry.forward.length === 0 && entry.inverse.length === 0) return;
    set((s) => ({
      past: [...s.past, entry],
      future: [],
    }));
  },

  undo: () => {
    const { past, future } = get();
    if (past.length === 0) return false;
    const last = past[past.length - 1];
    applyToDocument(last.inverse);
    set({
      past: past.slice(0, -1),
      future: [...future, last],
    });
    return true;
  },

  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return false;
    const last = future[future.length - 1];
    applyToDocument(last.forward);
    set({
      past: [...past, last],
      future: future.slice(0, -1),
    });
    return true;
  },

  clear: () => set({ past: [], future: [] }),
}));
