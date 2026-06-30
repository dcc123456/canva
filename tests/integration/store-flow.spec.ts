// store-flow.spec.ts — integration test: create document, addOverlay,
// undo, redo, and verify the resulting state.
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore } from '../../src/store/documentStore';
import { useHistoryStore } from '../../src/store/historyStore';
import type { HighlightItem, OverlayItem } from '../../src/core/types';

function makeHighlight(id: string, pageId: string, x: number): HighlightItem {
  return {
    id,
    pageId,
    type: 'highlight',
    rect: { x, y: 0, w: 10, h: 10 },
    color: '#FFEB3B',
    opacity: 0.4,
  };
}

describe('store integration', () => {
  beforeEach(() => {
    useDocumentStore.setState({
      pages: [
        { id: 'page-1', index: 0, rotation: 0, width: 595, height: 842, isBlank: true },
      ],
      overlays: [],
      pdfBytes: null,
      pdfName: '',
    });
    useHistoryStore.setState({ past: [], future: [] });
  });

  it('round-trips an overlay through undo + redo', () => {
    const { addOverlay } = useDocumentStore.getState();
    const overlay = makeHighlight('hl-1', 'page-1', 10);

    addOverlay(overlay);
    const afterAdd = useDocumentStore.getState();
    expect(afterAdd.overlays).toHaveLength(1);
    expect(afterAdd.overlays[0].id).toBe('hl-1');
    expect(useHistoryStore.getState().past).toHaveLength(1);

    expect(useHistoryStore.getState().undo()).toBe(true);
    expect(useDocumentStore.getState().overlays).toHaveLength(0);
    expect(useHistoryStore.getState().future).toHaveLength(1);

    expect(useHistoryStore.getState().redo()).toBe(true);
    expect(useDocumentStore.getState().overlays).toHaveLength(1);
    expect(useDocumentStore.getState().overlays[0].id).toBe('hl-1');
    expect(useHistoryStore.getState().past).toHaveLength(1);
  });

  it('keeps the page-list consistent when setPages filters overlays', () => {
    const { addOverlay, setPages } = useDocumentStore.getState();
    addOverlay(makeHighlight('hl-a', 'page-1', 0));
    addOverlay(makeHighlight('hl-b', 'page-1', 5));

    setPages([
      {
        id: 'page-2',
        index: 0,
        rotation: 0,
        width: 595,
        height: 842,
        isBlank: true,
      },
    ]);

    const overlays = useDocumentStore.getState().overlays as OverlayItem[];
    expect(overlays).toHaveLength(0);
  });

  it('updateOverlay changes the matching entry in place', () => {
    const { addOverlay, updateOverlay } = useDocumentStore.getState();
    addOverlay(makeHighlight('hl-1', 'page-1', 0));
    updateOverlay('hl-1', { opacity: 0.9 });
    const o = useDocumentStore.getState().overlays[0] as HighlightItem;
    expect(o.opacity).toBe(0.9);
    expect(o.color).toBe('#FFEB3B');
  });
});