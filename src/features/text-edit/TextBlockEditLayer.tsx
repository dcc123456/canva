// features/text-edit/TextBlockEditLayer.tsx
//
// Floating textarea editor for `text-block` overlays. Shown above the
// canvas when the user clicks a text-block while the `edit-text` tool
// is active. On commit (blur or Ctrl+Enter) it updates the overlay's
// text in place -- no engine round-trip, no pdfBytes rewrite.
//
// 重构后:提交是同步的(只调 useCommitTextBlock -> updateOverlay)。
// 原 PDF 字节始终不动,画布上的原字由 pdfjs 渲染,已编辑的 block 在
// ElementRenderer 里用白底矩形盖住原字 + 画 SVG 新文字。
//
// Selection 行为:
//   * 单击 block:仅选中 (selectedOverlayId = block.id),让右侧
//     Inspector 显示该 block 的属性面板,可在面板里编辑文字。
//   * 双击 block:进入画布内嵌 textarea 直接改字。
//   * 选中状态下再次单击同一 block:直接进入内嵌 textarea。
import { useEffect, useRef, useState } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { useEditorStore } from '../../store/editorStore';
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

  // 共享的"写回 overlay"逻辑(同样被 Inspector 用)。
  const { commit: commitToOverlay } = useCommitTextBlock();

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
  }

  function startEdit(block: TextBlockItem) {
    draftRef.current = block.text;
    setEditingId(block.id);
    setSelectedOverlayId(block.id);
  }

  function commitEdit(block: TextBlockItem | undefined, newText: string) {
    if (!block) {
      setEditingId(null);
      return;
    }
    commitToOverlay({ block, pageIndex: page.index, newText });
    setEditingId(null);
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
                // guarantees the ref callback runs - without it, React
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
                  commitEdit(b, e.currentTarget.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    commitEdit(
                      b,
                      (e.currentTarget as HTMLTextAreaElement).value
                    );
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                // Stop events from bubbling up to the wrapper div so we
                // don't restart the same edit on mouseup.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="h-full w-full resize-none border-0 bg-white outline-none ring-0 focus:bg-white overflow-hidden"
                style={{
                  fontSize: Math.max(8, b.fontSize * zoom),
                  lineHeight: String(b.lineHeight || 1.2),
                  fontFamily: b.font,
                  fontWeight: b.bold ? 700 : 400,
                  fontStyle: b.italic ? 'italic' : 'normal',
                  color: b.color || '#000000',
                  padding: 0,
                }}
              />
            ) : null}
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
    </div>
  );
}
