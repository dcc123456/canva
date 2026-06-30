// features/text-edit/useCommitTextBlock.ts
//
// 共享的"把 text-block 的新文字真正写回 PDF 字节流"逻辑,被
// TextBlockEditLayer(画布上的浮层 textarea)和 Inspector(右侧属性
// 面板的文字内容输入框)同时调用。
//
// 流程:
//   1. 拿到当前引擎(mupdf > pdfium > pdflib-overlay)。
//   2. 调用 `engine.writeTextBlock` —— 对 mupdf 来说会触发 Redact +
//      applyRedactions 把原文字从 PDF 字节流里抠掉,返回新的 PDF
//      字节。
//   3. 用新字节替换 store.pdfBytes,这样下一次渲染时原文字真的不
//      在画布上了。
//   4. 更新 overlay 自身的 text + source,让 flatten 阶段知道这个
//      block 已经走过引擎,不需要再次处理。
import { useCallback, useState } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { ensureEngine, getCachedEngine } from '../../core/engine';
import type { TextBlockItem } from '../../core/types';

export interface CommitOptions {
  block: TextBlockItem;
  pageIndex: number;
  newText: string;
}

export interface UseCommitTextBlockReturn {
  commit: (options: CommitOptions) => Promise<boolean>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
}

export function useCommitTextBlock(): UseCommitTextBlockReturn {
  const setPdfBytes = useDocumentStore((s) => s.setPdfBytes);
  const updateOverlay = useDocumentStore((s) => s.updateOverlay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(
    async ({ block, pageIndex, newText }: CommitOptions): Promise<boolean> => {
      if (newText === block.text) {
        return true;
      }
      // 直接从 store 当下快照取 pdfBytes,避免 stale closure:在用户连续
      // 提交多个 block 时,第二次 commit 可能仍闭包到第一次 commit 之前
      // 的 bytes,从而把第一次的删字成果丢掉。
      const pdfBytes = useDocumentStore.getState().pdfBytes;
      if (!pdfBytes) {
        setError('当前文档未加载 PDF');
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const engine = getCachedEngine() ?? (await ensureEngine('edit'));
        if (!engine) throw new Error('引擎不可用');
        // 给引擎传一份 clone,而不是 store 里那个 buffer 本身 —— 因为
        // 工程上 pdfjs 的 worker 会在 getDocument 时 transfer 它的
        // ArrayBuffer 并 detach;如果引擎里有任何步骤复用该 buffer,
        // 就会触发 "ArrayBuffer at index 0 is already detached"。
        const result = await engine.writeTextBlock({
          pageIndex,
          blockId: block.id,
          newText,
          block: {
            id: block.id,
            bbox: block.bbox,
            text: block.text,
            font: block.font,
            fontSize: block.fontSize,
            color: block.color,
          },
          pdfBytes: new Uint8Array(pdfBytes),
        });
        // setPdfBytes 内部会再深拷贝一次进入 store,所以 result.bytes
        // 与 store.pdfBytes 是两个独立的 owner。
        setPdfBytes(result.bytes);
        updateOverlay(block.id, {
          text: newText,
          source: result.source,
        } as Partial<TextBlockItem>);
        // 触发 App 重新加载 pdfjs 文档 —— store.pdfBytes 变了,但是
        // pdfjs 的 PDFDocumentProxy 是个一次性快照,需要重建才能让
        // 画布显示"原字消失,新字落位"的真实结果。
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('canva:pdf-bytes-replaced'));
        }
        // eslint-disable-next-line no-console
        console.log(
          '[useCommitTextBlock] commit ok: source=%s, new bytes=%d (was %d)',
          result.source,
          result.bytes.byteLength,
          pdfBytes.byteLength
        );
        return true;
      } catch (err) {
        console.error('[useCommitTextBlock] commit failed:', err);
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [setPdfBytes, updateOverlay]
  );

  return { commit, busy, error, clearError: () => setError(null) };
}
