import { describe, it, expect, beforeEach } from 'vitest';
import { useEngineStore } from '../../src/store/engineStore';

describe('engineStore', () => {
  beforeEach(() => {
    useEngineStore.setState({
      mupdfReady: false,
      mupdfLoading: false,
      mupdfError: null,
      currentEngine: 'pdfjs',
    });
  });

  it('starts in a clean state', () => {
    const s = useEngineStore.getState();
    expect(s.mupdfReady).toBe(false);
    expect(s.mupdfLoading).toBe(false);
    expect(s.mupdfError).toBeNull();
    expect(s.currentEngine).toBe('pdfjs');
  });

  it('records an error and clears loading flag', () => {
    useEngineStore.getState().setMupdfError('something broke');
    const s = useEngineStore.getState();
    expect(s.mupdfError).toBe('something broke');
    expect(s.mupdfLoading).toBe(false);
  });

  it('dismisses the error so the overlay closes (regression: LoadingOverlay trap)', () => {
    useEngineStore.getState().setMupdfError('mupdf unavailable');
    expect(useEngineStore.getState().mupdfError).not.toBeNull();
    useEngineStore.getState().setMupdfError(null);
    expect(useEngineStore.getState().mupdfError).toBeNull();
  });

  it('flips loading back to false once finished', () => {
    useEngineStore.getState().setMupdfLoading(true);
    expect(useEngineStore.getState().mupdfLoading).toBe(true);
    useEngineStore.getState().setMupdfLoading(false);
    expect(useEngineStore.getState().mupdfLoading).toBe(false);
  });
});
