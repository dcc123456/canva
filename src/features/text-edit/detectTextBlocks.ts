// features/text-edit/detectTextBlocks.ts
//
// Wrapper around the engine router that fetches text blocks for a given
// page. Returns plain `TextBlock[]` (no overlays) so the caller can shape
// them into store entries. Also exposes the resolved engine kind so the
// caller knows whether the result came from mupdf / pdfium (真删字) or
// pdflib-overlay (兜底白底覆盖)。
import { ensureEngine } from '../../core/engine';
import type { EngineKind, TextBlock } from '../../core/engine';

export interface DetectTextBlocksForPageOptions {
  pageIndex: number;
  pdfBytes: Uint8Array;
  onProgress?: (progress: number, label?: string) => void;
}

export interface DetectTextBlocksResult {
  blocks: TextBlock[];
  /** The engine implementation that produced these blocks. */
  source: EngineKind;
}

export async function detectTextBlocksForPage(
  options: DetectTextBlocksForPageOptions
): Promise<DetectTextBlocksResult> {
  const engine = await ensureEngine('edit', {
    onProgress: options.onProgress,
  });
  if (!engine) {
    throw new Error('PDF 引擎不可用');
  }
  const blocks = await engine.detectTextBlocks({
    pageIndex: options.pageIndex,
    pdfBytes: options.pdfBytes,
  });
  return { blocks, source: engine.kind };
}
