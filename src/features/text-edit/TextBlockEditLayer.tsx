// features/text-edit/TextBlockEditLayer.tsx
//
// Floating contenteditable editor for `text-block` overlays. Shown above the
// canvas when the user clicks a text-block while the `edit-text` tool is
// active. On commit (blur or Ctrl+Enter) it updates the overlay's text and
// segments in place -- no engine round-trip, no pdfBytes rewrite.
//
// 重构后:提交是同步的(只调 useCommitTextBlock -> updateOverlay)。
// 原 PDF 字节始终不动,画布上的原字由 pdfjs 渲染,已编辑的 block 在
// ElementRenderer 里用白底矩形盖住原字 + 画 SVG 新文字。
//
// Phase 6: textarea replaced with contenteditable div, B/I/color toolbar
// for inline rich-text segment editing.
//
// Selection 行为:
//   * 单击 block:仅选中 (selectedOverlayId = block.id),让右侧
//     Inspector 显示该 block 的属性面板,可在面板里编辑文字。
//   * 双击 block:进入画布内嵌 contenteditable 直接改字。
//   * 选中状态下再次单击同一 block:直接进入内嵌编辑。
import { useEffect, useRef, useState } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import { useEditorStore } from '../../store/editorStore';
import { useCommitTextBlock } from './useCommitTextBlock';
import { FloatingTextToolbar } from '../../components/FloatingTextToolbar';
import type { TextBlockItem, RichTextSegment, PageMeta } from '../../core/types';

// ---------- Rich-text segment utilities (shared logic) -----------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeColor(color: string): string {
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) {
    const r = parseInt(m[1]).toString(16).padStart(2, '0');
    const g = parseInt(m[2]).toString(16).padStart(2, '0');
    const b = parseInt(m[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return color;
}

function segmentsToHtml(
  segments: RichTextSegment[] | undefined,
  text: string
): string {
  if (!segments || segments.length === 0) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
  return segments
    .map((s) => {
      let html = escapeHtml(s.text).replace(/\n/g, '<br>');
      if (s.bold) html = `<b>${html}</b>`;
      if (s.italic) html = `<i>${html}</i>`;
      if (s.color) html = `<span style="color:${s.color}">${html}</span>`;
      return html;
    })
    .join('');
}

function extractSegments(el: HTMLElement): {
  text: string;
  segments: RichTextSegment[];
} {
  const raw: RichTextSegment[] = [];

  function walk(
    node: Node,
    pBold: boolean,
    pItalic: boolean,
    pColor?: string
  ): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? '';
      if (t) {
        const seg: RichTextSegment = { text: t };
        if (pBold) seg.bold = true;
        if (pItalic) seg.italic = true;
        if (pColor) seg.color = pColor;
        raw.push(seg);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const elem = node as HTMLElement;
    if (elem.tagName === 'BR') {
      const seg: RichTextSegment = { text: '\n' };
      if (pBold) seg.bold = true;
      if (pItalic) seg.italic = true;
      if (pColor) seg.color = pColor;
      raw.push(seg);
      return;
    }
    const bold =
      pBold ||
      elem.tagName === 'B' ||
      elem.style.fontWeight === 'bold' ||
      elem.style.fontWeight === '700';
    const italic =
      pItalic || elem.tagName === 'I' || elem.style.fontStyle === 'italic';
    const color =
      normalizeColor(elem.style.color || elem.getAttribute('color') || '') ||
      pColor;
    elem.childNodes.forEach((c) => walk(c, bold, italic, color));
  }

  el.childNodes.forEach((c) => walk(c, false, false, undefined));

  // Merge adjacent segments with identical formatting.
  const merged: RichTextSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (
      last &&
      !!last.bold === !!seg.bold &&
      !!last.italic === !!seg.italic &&
      (last.color || '') === (seg.color || '')
    ) {
      last.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  const fullText = merged.map((s) => s.text).join('');
  return { text: fullText, segments: merged };
}

// ---------- Component --------------------------------------------------------

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

  const editingIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editElRef = useRef<HTMLDivElement | null>(null);

  // 共享的"写回 overlay"逻辑(同样被 Inspector 用)。
  const { commit: commitToOverlay } = useCommitTextBlock();

  // Force-update tick: editingId is stored in a ref (not state) so we need
  // a manual re-render trigger when it changes.
  const [, setTick] = useState(0);
  const forceUpdate = () => setTick((t) => t + 1);

  useEffect(() => {
    if (tool !== 'edit-text') {
      // 切换工具时，如果正在编辑，先提交编辑内容到 store。
      // contenteditable 被 unmount 前 onBlur 可能不触发，所以这里
      // 显式提取 segments 并 commit，避免修改丢失。
      const editingId = editingIdRef.current;
      if (editingId && editElRef.current) {
        const { text, segments } = extractSegments(editElRef.current);
        const block = useDocumentStore
          .getState()
          .overlays.find(
            (o): o is TextBlockItem => o.id === editingId && o.type === 'text-block'
          );
        if (block) {
          commitToOverlay({
            block,
            pageIndex: page.index,
            newText: text,
            segments,
          });
        }
      }
      editingIdRef.current = null;
    }
  }, [tool, commitToOverlay, page.index]);

  if (tool !== 'edit-text') return null;
  const blocks = overlays.filter(
    (o): o is TextBlockItem => o.type === 'text-block' && o.pageId === page.id
  );

  function selectOnly(block: TextBlockItem) {
    setSelectedOverlayId(block.id);
  }

  // Commit the in-progress edit (if any) without relying on onBlur, which
  // may not fire because pointerdown on another block calls preventDefault
  // and keeps the contenteditable focused. Must be called before switching
  // to / selecting another block so the edit isn't lost on unmount.
  function commitCurrentEdit() {
    const editingId = editingIdRef.current;
    if (!editingId || !editElRef.current) return;
    const { text, segments } = extractSegments(editElRef.current);
    const block = useDocumentStore
      .getState()
      .overlays.find(
        (o): o is TextBlockItem => o.id === editingId && o.type === 'text-block'
      );
    // Always commit -- the text may be unchanged but the style (bold/italic/
    // color via segments) could have changed. commitToOverlay handles the
    // no-op case internally.
    if (block) {
      commitToOverlay({
        block,
        pageIndex: page.index,
        newText: text,
        segments,
      });
    }
    editingIdRef.current = null;
  }

  function startEdit(block: TextBlockItem) {
    editingIdRef.current = block.id;
    setSelectedOverlayId(block.id);
    // Force re-render so the contenteditable appears.
    forceUpdate();
  }

  function commitEdit(
    block: TextBlockItem | undefined,
    newText: string,
    segments?: RichTextSegment[]
  ) {
    if (!block) {
      editingIdRef.current = null;
      forceUpdate();
      return;
    }
    commitToOverlay({
      block,
      pageIndex: page.index,
      newText,
      segments,
    });
    editingIdRef.current = null;
    forceUpdate();
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0"
      style={{ width: page.width * zoom, height: page.height * zoom }}
    >
      {blocks.map((b) => {
        const isSelected = selectedOverlayId === b.id;
        const isEditing = editingIdRef.current === b.id;
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
            onPointerDown={(e) => {
              if (isEditing) return;
              e.preventDefault();
              e.stopPropagation();
              // Commit any in-progress edit on another block before switching.
              // onBlur won't fire here because preventDefault keeps the
              // contenteditable focused, so we must commit manually.
              if (editingIdRef.current && editingIdRef.current !== b.id) {
                commitCurrentEdit();
              }
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
              if (editingIdRef.current && editingIdRef.current !== b.id) {
                commitCurrentEdit();
              }
              startEdit(b);
            }}
          >
            {isEditing ? (
              <div className="flex h-full w-full flex-col overflow-hidden bg-white">
                <FloatingTextToolbar editorRef={editElRef} />
                {/* Contenteditable body */}
                <div
                  key={b.id}
                  ref={(el) => {
                    editElRef.current = el;
                    if (!el) return;
                    el.innerHTML = segmentsToHtml(b.segments, b.text);
                    el.focus({ preventScroll: true });
                  }}
                  contentEditable
                  suppressContentEditableWarning
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const { text, segments } = extractSegments(
                      e.currentTarget
                    );
                    commitEdit(b, text, segments);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      const { text, segments } = extractSegments(
                        e.currentTarget as HTMLElement
                      );
                      commitEdit(b, text, segments);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      // Reset to original content before exiting.
                      (e.currentTarget as HTMLElement).innerHTML =
                        segmentsToHtml(b.segments, b.text);
                      editingIdRef.current = null;
                      forceUpdate();
                    }
                  }}
                  className="flex-1 overflow-auto outline-none"
                  style={{
                    fontSize: Math.max(8, b.fontSize * zoom),
                    lineHeight: String(b.lineHeight || 1.2),
                    fontFamily: b.font,
                    fontWeight: b.bold ? 700 : 400,
                    fontStyle: b.italic ? 'italic' : 'normal',
                    color: b.color || '#000000',
                    padding: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                />
              </div>
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
                x
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
