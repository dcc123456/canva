// features/text-edit/TextBlockEditLayer.tsx
//
// Floating textarea editor for `text-block` overlays. Shown above the
// canvas when the user clicks a text-block while the `edit-text` tool
// is active. On commit (blur or Ctrl+Enter) it asks the engine to
// write the new text back into the PDF and updates the store.
//
// Selection 行为:
//   * 单击 block:仅选中 (selectedOverlayId = block.id),让右侧
//     Inspector 显示该 block 的属性面板,可在面板里编辑文字。
//   * 双击 block:进入画布内嵌 textarea 直接改字。
//   * 选中状态下再次单击同一 block:直接进入内嵌 textarea。
import { useEffect, useRef, useState } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { useEditorStore } from '../../store/editorStore';
import { ensureEngine } from '../../core/engine';
import { useCommitTextBlock } from './useCommitTextBlock';
import type { TextBlockItem, PageMeta } from '../../core/types';

export interface TextBlockEditLayerProps {
  page: PageMeta;
}

export function TextBlockEditLayer({ page }: TextBlockEditLayerProps) {
  const tool = useEditorStore((s) => s.tool);
  const zoom = useEditorStore((s) => s.zoom);
  const selectedOverlayId = useEditorStore((s) => s.selectedOverlayId);
  const setSelectedOverlayId = useEditorStore((s) => s.setSelectedOverlayId);
  const overlays = useDocumentStore((s) => s.overlays);
  const removeOverlay = useDocumentStore((s) => s.removeOverlay);

  const [editingId, setEditingId] = useState<string | null>(null);
  // We deliberately keep `draft` uncontrolled (a ref) for the textarea.
  // Using `value={draft}` triggers React's controlled-component behaviour
  // which under some HMR + focus races re-renders the textarea while the
  // user is typing and visibly refuses to accept input. The ref-based
  // uncontrolled version is bullet-proof: `setDraft` is invoked once on
  // commit, and during typing the browser owns the value.
  const draftRef = useRef<string>('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 共享的"写回 PDF 字节流"逻辑(同样被 Inspector 用)。
  const { commit: commitToEngine, busy, error, clearError } = useCommitTextBlock();

  useEffect(() => {
    if (tool !== 'edit-text') {
      setEditingId(null);
    }
  }, [tool]);

  if (tool !== 'edit-text') return null;
  const blocks = overlays.filter(
    (o): o is TextBlockItem => o.type === 'text-block' && o.pageId === page.id
  );

  function selectOnly(block: TextBlockItem) {
    setSelectedOverlayId(block.id);
    clearError();
    // Pre-warm the engine so the first commit isn't slowed down.
    void ensureEngine('edit').catch(() => undefined);
  }

  function startEdit(block: TextBlockItem) {
    draftRef.current = block.text;
    setEditingId(block.id);
    setSelectedOverlayId(block.id);
    clearError();
    void ensureEngine('edit').catch(() => undefined);
  }

  async function commit(block: TextBlockItem | undefined, newText: string) {
    if (!block) {
      setEditingId(null);
      return;
    }
    const ok = await commitToEngine({ block, pageIndex: page.index, newText });
    if (ok) setEditingId(null);
  }

  function cancel() {
    setEditingId(null);
    clearError();
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0"
      style={{ width: page.width * zoom, height: page.height * zoom }}
    >
      {blocks.map((b) => {
        const isSelected = selectedOverlayId === b.id;
        const isEditing = editingId === b.id;
        return (
          <div
            key={b.id}
            className={
              'absolute rounded-sm ' +
              (isSelected || isEditing
                ? 'border-2 border-blue-600 border-dashed'
                : 'border border-blue-400 border-dashed opacity-60 hover:opacity-100')
            }
            style={{
              left: b.bbox.x * zoom,
              top: b.bbox.y * zoom,
              width: b.bbox.w * zoom,
              height: b.bbox.h * zoom,
              pointerEvents: 'auto',
              cursor: 'text',
            }}
            // 单击: 仅选中 (会让 Inspector 显示文字内容编辑框)。
            // 已选中再点 / 双击: 直接进入画布内嵌 textarea。
            onPointerDown={(e) => {
              if (isEditing) return;
              e.preventDefault();
              e.stopPropagation();
              if (isSelected) {
                startEdit(b);
              } else {
                selectOnly(b);
              }
            }}
            onDoubleClick={(e) => {
              if (isEditing) return;
              e.preventDefault();
              e.stopPropagation();
              startEdit(b);
            }}
          >
            {isEditing ? (
              <textarea
                // Re-mount the textarea whenever we switch which block is
                // being edited. This guarantees a fresh DOM node and
                // guarantees the ref callback runs — without it, React
                // reuses the old textarea and the `select()` would point
                // to stale text.
                key={b.id}
                ref={(el) => {
                  if (!el) return;
                  // Sync the DOM value with the block's text. After HMR
                  // the textarea may carry content from a previous edit.
                  el.value = b.text;
                  draftRef.current = b.text;
                  // Focus immediately, then select-all so the user can
                  // hit Delete / start typing to fully replace the
                  // original line of text.
                  el.focus({ preventScroll: true });
                  el.select();
                }}
                // `readOnly={false}` is the default but explicit so it's
                // clear no other prop is locking us out.
                readOnly={false}
                disabled={false}
                onInput={(e) => {
                  draftRef.current = e.currentTarget.value;
                }}
                onBlur={(e) => {
                  void commit(b, e.currentTarget.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void commit(
                      b,
                      (e.currentTarget as HTMLTextAreaElement).value
                    );
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                  }
                }}
                // Stop events from bubbling up to the wrapper div so we
                // don't restart the same edit on mouseup.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="h-full w-full resize-none border-0 bg-white/95 p-1 text-xs text-gray-900 outline-none ring-0 focus:bg-white"
                style={{ fontSize: Math.max(8, b.bbox.h * zoom * 0.7) }}
              />
            ) : (
              // 非编辑态: 只保留蓝色虚线框,不再叠加预览文字 ——
              // 因为原 PDF 字符已经在画布同一位置渲染,再画一遍
              // 会跟原文字重叠造成"看不清字"的观感。"兜底"角标
              // 仍然显示在右上角,提示用户当前引擎是哪条路径。
              <div className="pointer-events-none absolute right-0 top-0 flex items-start">
                {b.source === 'pdflib-overlay' && (
                  <span
                    className="rounded bg-amber-100 px-1 text-[9px] text-amber-800"
                    title="未加载 MuPDF/PDFium,使用兜底引擎(pdf-lib 白底覆盖 + 重绘),非字节级 in-place 改写。"
                  >
                    兜底
                  </span>
                )}
              </div>
            )}
            {!isEditing && (
              <button
                type="button"
                title="删除此文本块"
                onClick={(e) => {
                  e.stopPropagation();
                  removeOverlay(b.id);
                  if (selectedOverlayId === b.id) setSelectedOverlayId(null);
                }}
                className="absolute -right-3 -top-3 hidden h-5 w-5 items-center justify-center rounded-full border border-red-400 bg-white text-[10px] text-red-600 group-hover:flex"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {error && (
        <div className="pointer-events-auto absolute left-2 top-2 max-w-[300px] rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {busy && (
        <div className="pointer-events-none absolute right-2 top-2 rounded bg-blue-600 px-2 py-1 text-[10px] text-white">
          正在写回…
        </div>
      )}
    </div>
  );
}
