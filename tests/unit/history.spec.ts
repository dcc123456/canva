// history.spec.ts — verifies undo/redo across 5 mutations on the document store.
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useHistoryStore } from '../../src/store/historyStore';

describe('history store', () => {
  beforeEach(() => {
    // Reset both stores to a known state.
    useDocumentStore.setState({
      pages: [
        { id: 'p0', index: 0, rotation: 0, width: 595, height: 842, isBlank: true },
      ],
      overlays: [],
      pdfBytes: null,
      pdfName: '',
    });
    useHistoryStore.setState({ past: [], future: [] });
  });

  it('undoes and redoes a single addOverlay', () => {
    const { addOverlay } = useDocumentStore.getState();
    addOverlay({
      id: 'h1',
      pageId: 'p0',
      type: 'highlight',
      rect: { x: 0, y: 0, w: 10, h: 10 },
      color: '#FFEB3B',
      opacity: 0.4,
    });
    expect(useDocumentStore.getState().overlays.length).toBe(1);
    expect(useHistoryStore.getState().undo()).toBe(true);
    expect(useDocumentStore.getState().overlays.length).toBe(0);
    expect(useHistoryStore.getState().redo()).toBe(true);
    expect(useDocumentStore.getState().overlays.length).toBe(1);
  });

  it('walks five undo / redo steps in order', () => {
    const { addOverlay } = useDocumentStore.getState();
    for (let i = 0; i < 5; i += 1) {
      addOverlay({
        id: `o${i}`,
        pageId: 'p0',
        type: 'highlight',
        rect: { x: i, y: 0, w: 1, h: 1 },
        color: '#FFEB3B',
        opacity: 0.4,
      });
    }
    expect(useDocumentStore.getState().overlays.length).toBe(5);

    // Undo all five.
    for (let i = 4; i >= 0; i -= 1) {
      expect(useHistoryStore.getState().undo()).toBe(true);
      expect(useDocumentStore.getState().overlays.length).toBe(i);
    }
    // Nothing left to undo.
    expect(useHistoryStore.getState().undo()).toBe(false);

    // Redo all five.
    for (let i = 1; i <= 5; i += 1) {
      expect(useHistoryStore.getState().redo()).toBe(true);
      expect(useDocumentStore.getState().overlays.length).toBe(i);
    }
    // Nothing left to redo.
    expect(useHistoryStore.getState().redo()).toBe(false);
  });

  it('clears the redo stack on a new edit', () => {
    const { addOverlay } = useDocumentStore.getState();
    addOverlay({
      id: 'a',
      pageId: 'p0',
      type: 'highlight',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      color: '#000',
      opacity: 0.5,
    });
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().future.length).toBe(1);
    addOverlay({
      id: 'b',
      pageId: 'p0',
      type: 'highlight',
      rect: { x: 0, y: 0, w: 2, h: 2 },
      color: '#000',
      opacity: 0.5,
    });
    expect(useHistoryStore.getState().future.length).toBe(0);
  });

  it('returns false when there is nothing to undo', () => {
    expect(useHistoryStore.getState().undo()).toBe(false);
    expect(useHistoryStore.getState().redo()).toBe(false);
  });
});