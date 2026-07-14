// Inspector: right-side property panel for the currently selected overlay.
// - Common: X / Y / W / H / rotation + delete.
// - Text: font family (built-ins + Chinese fonts + Custom), size, color,
//   bold/italic/underline, align, line-height, rich-text contenteditable.
// - TextBlock: same as Text plus commit-on-blur via useCommitTextBlock.
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useDocumentStore } from '../store/documentStore';
import { useEditorStore } from '../store/editorStore';
import { useCommitTextBlock } from '../features/text-edit/useCommitTextBlock';
import { FloatingTextToolbar } from './FloatingTextToolbar';
import type {
  DrawingItem,
  HighlightItem,
  ImageItem,
  OverlayItem,
  PageMeta,
  RichTextSegment,
  StickyNoteItem,
  TextAlign,
  TextBlockItem,
  TextItem,
} from '../core/types';

const BUILTIN_FONTS = [
  'Helvetica',
  'TimesRoman',
  'Courier',
  'SimSun',
  'SimHei',
  'Microsoft YaHei',
  'KaiTi',
] as const;
type BuiltinFont = (typeof BUILTIN_FONTS)[number];
const isBuiltinFont = (s: string): s is BuiltinFont =>
  (BUILTIN_FONTS as readonly string[]).includes(s);

// ---------- Rich-text segment utilities --------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Convert rgb(r, g, b) to #rrggbb; pass through hex and named colors. */
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

/** Build innerHTML for the contenteditable from segments (or plain text). */
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

/**
 * Walk a contenteditable's childNodes and extract RichTextSegments.
 * Handles <b>, <i>, <span style="color">, <font color>, <br>, and nesting.
 */
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

// ---------- Shared sub-components --------------------------------------------

interface CommonBoxFields {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

function readCommon(item: OverlayItem): CommonBoxFields | null {
  switch (item.type) {
    case 'highlight': {
      const it = item as HighlightItem;
      return { x: it.rect.x, y: it.rect.y, w: it.rect.w, h: it.rect.h, rotation: 0 };
    }
    case 'note': {
      const it = item as StickyNoteItem;
      return { x: it.position.x, y: it.position.y, w: it.size.w, h: it.size.h, rotation: 0 };
    }
    case 'text': {
      const it = item as TextItem;
      return { x: it.position.x, y: it.position.y, w: it.size.w, h: it.size.h, rotation: it.rotation };
    }
    case 'image': {
      const it = item as ImageItem;
      return { x: it.position.x, y: it.position.y, w: it.size.w, h: it.size.h, rotation: it.rotation };
    }
    case 'drawing': {
      return null;
    }
    case 'text-block':
    case 'form-field': {
      return { x: item.bbox.x, y: item.bbox.y, w: item.bbox.w, h: item.bbox.h, rotation: 0 };
    }
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

function applyCommon(
  item: OverlayItem,
  common: CommonBoxFields
): Partial<OverlayItem> {
  switch (item.type) {
    case 'highlight':
      return { rect: { x: common.x, y: common.y, w: common.w, h: common.h } } as Partial<OverlayItem>;
    case 'note':
      return {
        position: { x: common.x, y: common.y },
        size: { w: common.w, h: common.h },
      } as Partial<OverlayItem>;
    case 'text':
      return {
        position: { x: common.x, y: common.y },
        size: { w: common.w, h: common.h },
        rotation: common.rotation,
      } as Partial<OverlayItem>;
    case 'image':
      return {
        position: { x: common.x, y: common.y },
        size: { w: common.w, h: common.h },
        rotation: common.rotation,
      } as Partial<OverlayItem>;
    case 'text-block':
    case 'form-field':
      return { bbox: { x: common.x, y: common.y, w: common.w, h: common.h } } as Partial<OverlayItem>;
    default:
      return {};
  }
}

function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      className="w-20 rounded border px-1 py-0.5 text-right"
    />
  );
}

function NumberField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
      <span className="w-10 shrink-0">{label}</span>
      {children}
    </label>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={clsx(
        'h-7 min-w-7 rounded border px-2 text-sm',
        active
          ? 'border-blue-500 bg-blue-100 text-blue-800'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      )}
    >
      {children}
    </button>
  );
}

/** Three-button alignment selector (left / center / right). */
function AlignButtonGroup({
  align,
  onChange,
}: {
  align: TextAlign;
  onChange: (a: TextAlign) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <ToggleButton
        active={align === 'left'}
        onClick={() => onChange('left')}
        title="左对齐"
      >
        左
      </ToggleButton>
      <ToggleButton
        active={align === 'center'}
        onClick={() => onChange('center')}
        title="居中"
      >
        中
      </ToggleButton>
      <ToggleButton
        active={align === 'right'}
        onClick={() => onChange('right')}
        title="右对齐"
      >
        右
      </ToggleButton>
    </div>
  );
}

/** Shared font selector dropdown for Text and TextBlock controls. */
function FontSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (font: string) => void;
}) {
  const fontIsBuiltin = isBuiltinFont(value);
  return (
    <select
      value={fontIsBuiltin ? value : 'Custom'}
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'Custom') {
          const name = window.prompt('输入字体名称', value || 'sans-serif') ?? value;
          onChange(name);
        } else {
          onChange(v);
        }
      }}
      className="rounded border px-1 py-0.5"
    >
      {BUILTIN_FONTS.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
      <option value="Custom">Custom...</option>
    </select>
  );
}

/**
 * RichTextEditor: a contenteditable div with a B/I/color toolbar.
 * Used by both TextControls (TextItem) and TextBlockControls (TextBlockItem).
 *
 * The editor is uncontrolled: initial content is set via innerHTML on mount
 * and whenever the external text changes while the editor is not focused.
 * On blur the parent's onCommit callback receives the extracted plain text
 * and RichTextSegment[].
 */
function RichTextEditor({
  editorRef,
  initialText,
  initialSegments,
  font,
  fontSize,
  color,
  bold,
  italic,
  onInput,
  onBlur,
}: {
  editorRef: React.RefObject<HTMLDivElement | null>;
  initialText: string;
  initialSegments?: RichTextSegment[];
  font: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  onInput?: () => void;
  onBlur?: () => void;
}) {
  // Set / refresh innerHTML when the external source text changes and the
  // editor is not focused (avoids clobbering the user's in-progress edit).
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const html = segmentsToHtml(initialSegments, initialText);
    if (el.innerHTML !== html) {
      el.innerHTML = html;
    }
  }, [initialText, initialSegments, editorRef]);

  return (
    <div>
      <FloatingTextToolbar editorRef={editorRef} />
      {/* contenteditable body */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onPointerDown={(e) => e.stopPropagation()}
        onInput={() => onInput?.()}
        onBlur={() => onBlur?.()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            const el = editorRef.current;
            if (el) {
              el.innerHTML = segmentsToHtml(initialSegments, initialText);
            }
            (e.currentTarget as HTMLElement).blur();
          }
        }}
        className="min-h-[3rem] rounded border border-gray-300 px-1 py-0.5 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        style={{
          fontFamily: font,
          fontSize: `${Math.max(10, Math.min(20, fontSize))}px`,
          color,
          fontWeight: bold ? 700 : 400,
          fontStyle: italic ? 'italic' : 'normal',
          lineHeight: '1.2',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
    </div>
  );
}

// ---------- Main Inspector ----------------------------------------------------

export function Inspector() {
  const selectedId = useEditorStore((s) => s.selectedOverlayId);
  const setSelectedOverlayId = useEditorStore((s) => s.setSelectedOverlayId);
  const overlays = useDocumentStore((s) => s.overlays);
  const pages = useDocumentStore((s) => s.pages);
  const updateOverlay = useDocumentStore((s) => s.updateOverlay);
  const removeOverlay = useDocumentStore((s) => s.removeOverlay);

  const item = useMemo(
    () => overlays.find((o) => o.id === selectedId) ?? null,
    [overlays, selectedId]
  );

  if (!item) {
    return (
      <aside className="flex h-full w-[260px] flex-col gap-2 overflow-y-auto border-l bg-gray-50 p-3 text-xs text-gray-500">
        <div className="text-sm font-semibold text-gray-700">属性</div>
        <div className="rounded border border-dashed border-gray-300 bg-white p-4 text-center">
          未选中任何叠加元素
        </div>
      </aside>
    );
  }

  const common = readCommon(item);
  const current = item;

  const patchCommon = (field: keyof CommonBoxFields, value: number) => {
    if (!common) return;
    const next: CommonBoxFields = { ...common, [field]: value };
    const patch = applyCommon(current, next);
    if (Object.keys(patch).length > 0) {
      updateOverlay(current.id, patch);
    }
  };

  return (
    <aside className="flex h-full w-[260px] flex-col gap-3 overflow-y-auto border-l bg-gray-50 p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-700">属性</div>
        <button
          type="button"
          onClick={() => {
            removeOverlay(item.id);
            setSelectedOverlayId(null);
          }}
          className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
          title="删除选中的元素 (Del)"
        >
          删除
        </button>
      </div>

      <div className="rounded border bg-white p-2">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">类型</div>
        <div className="text-sm text-gray-800">{typeLabel(item)}</div>
      </div>

      {common && (
        <div className="rounded border bg-white p-2">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">位置 / 尺寸</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="X">
              <NumberInput value={common.x} onChange={(v) => patchCommon('x', v)} />
            </NumberField>
            <NumberField label="Y">
              <NumberInput value={common.y} onChange={(v) => patchCommon('y', v)} />
            </NumberField>
            <NumberField label="W">
              <NumberInput value={common.w} min={1} onChange={(v) => patchCommon('w', v)} />
            </NumberField>
            <NumberField label="H">
              <NumberInput value={common.h} min={1} onChange={(v) => patchCommon('h', v)} />
            </NumberField>
            <NumberField label="旋转">
              <NumberInput
                value={common.rotation}
                step={5}
                onChange={(v) => patchCommon('rotation', v)}
              />
            </NumberField>
          </div>
        </div>
      )}

      {item.type === 'text' && <TextControls item={item} updateOverlay={updateOverlay} />}
      {item.type === 'text-block' && (
        <TextBlockControls
          item={item as TextBlockItem}
          page={pages.find((p) => p.id === (item as TextBlockItem).pageId) ?? null}
          updateOverlay={updateOverlay}
        />
      )}
      {item.type === 'note' && (
        <NoteControls
          item={item as StickyNoteItem}
          updateOverlay={updateOverlay}
        />
      )}
      {item.type === 'highlight' && (
        <HighlightControls
          item={item as HighlightItem}
          updateOverlay={updateOverlay}
        />
      )}
      {item.type === 'drawing' && (
        <DrawingControls
          item={item as DrawingItem}
          updateOverlay={updateOverlay}
        />
      )}
    </aside>
  );
}

function typeLabel(item: OverlayItem): string {
  switch (item.type) {
    case 'highlight':
      return '高亮';
    case 'note':
      return '便签';
    case 'text':
      return '文字';
    case 'image':
      return '图片';
    case 'drawing':
      return '画笔';
    case 'text-block':
      return '原文本块';
    case 'form-field':
      return '表单字段';
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

// ---------- TextControls (TextItem) ------------------------------------------

function TextControls({
  item,
  updateOverlay,
}: {
  item: TextItem;
  updateOverlay: (id: string, patch: Partial<OverlayItem>) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const align: TextAlign = item.align || 'left';

  return (
    <div className="rounded border bg-white p-2">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">文字</div>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          字体
          <FontSelector
            value={item.font}
            onChange={(font) => updateOverlay(item.id, { font } as Partial<OverlayItem>)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          字号
          <input
            type="number"
            min={6}
            max={144}
            value={item.fontSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) {
                updateOverlay(item.id, { fontSize: Math.max(6, Math.min(144, v)) } as Partial<OverlayItem>);
              }
            }}
            className="rounded border px-1 py-0.5"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
          颜色
          <input
            type="color"
            value={item.color}
            onChange={(e) =>
              updateOverlay(item.id, { color: e.target.value } as Partial<OverlayItem>)
            }
            className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          行距
          <input
            type="number"
            min={0.5}
            max={5}
            step={0.05}
            value={item.lineHeight ?? 1.2}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) {
                updateOverlay(item.id, {
                  lineHeight: Math.max(0.5, Math.min(5, v)),
                } as Partial<OverlayItem>);
              }
            }}
            className="rounded border px-1 py-0.5"
          />
        </label>
        {/* Phase 4: alignment buttons */}
        <div className="flex items-center gap-1">
          <AlignButtonGroup
            align={align}
            onChange={(a) => updateOverlay(item.id, { align: a } as Partial<OverlayItem>)}
          />
        </div>
        {/* Phase 6: contenteditable rich-text editor */}
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          文字内容
          <RichTextEditor
            key={item.id}
            editorRef={editorRef}
            initialText={item.text}
            initialSegments={item.segments}
            font={item.font}
            fontSize={item.fontSize}
            color={item.color}
            bold={item.bold}
            italic={item.italic}
            onBlur={() => {
              const el = editorRef.current;
              if (!el) return;
              const { text, segments } = extractSegments(el);
              const hasFormatting = segments.some(
                (s) => s.bold || s.italic || s.color
              );
              updateOverlay(item.id, {
                text,
                segments: hasFormatting ? segments : undefined,
              } as Partial<OverlayItem>);
            }}
          />
        </label>
      </div>
    </div>
  );
}

// ---------- NoteControls -----------------------------------------------------

function NoteControls({
  item,
  updateOverlay,
}: {
  item: StickyNoteItem;
  updateOverlay: (id: string, patch: Partial<OverlayItem>) => void;
}) {
  return (
    <div className="rounded border bg-white p-2">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">便签</div>
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        文字
        <textarea
          value={item.text}
          onChange={(e) => updateOverlay(item.id, { text: e.target.value } as Partial<OverlayItem>)}
          rows={3}
          className="rounded border px-1 py-0.5"
        />
      </label>
      <label className="mt-2 flex items-center justify-between text-xs text-gray-600">
        颜色
        <input
          type="color"
          value={item.color}
          onChange={(e) => updateOverlay(item.id, { color: e.target.value } as Partial<OverlayItem>)}
          className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
        />
      </label>
    </div>
  );
}

// ---------- HighlightControls ------------------------------------------------

function HighlightControls({
  item,
  updateOverlay,
}: {
  item: HighlightItem;
  updateOverlay: (id: string, patch: Partial<OverlayItem>) => void;
}) {
  return (
    <div className="rounded border bg-white p-2">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">高亮</div>
      <label className="flex items-center justify-between text-xs text-gray-600">
        颜色
        <input
          type="color"
          value={item.color}
          onChange={(e) => updateOverlay(item.id, { color: e.target.value } as Partial<OverlayItem>)}
          className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
        />
      </label>
      <label className="mt-2 flex flex-col gap-1 text-xs text-gray-600">
        不透明度
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={item.opacity}
          onChange={(e) => updateOverlay(item.id, { opacity: Number(e.target.value) } as Partial<OverlayItem>)}
        />
      </label>
    </div>
  );
}

// ---------- DrawingControls --------------------------------------------------

function DrawingControls({
  item,
  updateOverlay,
}: {
  item: DrawingItem;
  updateOverlay: (id: string, patch: Partial<OverlayItem>) => void;
}) {
  return (
    <div className="rounded border bg-white p-2">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">画笔</div>
      <label className="flex items-center justify-between text-xs text-gray-600">
        颜色
        <input
          type="color"
          value={item.color}
          onChange={(e) => updateOverlay(item.id, { color: e.target.value } as Partial<OverlayItem>)}
          className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
        />
      </label>
      <label className="mt-2 flex flex-col gap-1 text-xs text-gray-600">
        粗细
        <input
          type="range"
          min={0.5}
          max={12}
          step={0.5}
          value={item.width}
          onChange={(e) => updateOverlay(item.id, { width: Number(e.target.value) } as Partial<OverlayItem>)}
        />
      </label>
    </div>
  );
}

// ---------- TextBlockControls ------------------------------------------------
//
// Inspector 面板里的"原文本块"控件:
//   * 文字内容 contenteditable -- 提交时调 useCommitTextBlock。
//   * 字体 / 字号 / 颜色 / 行距 / 对齐 -- 只影响 flatten 阶段重画新文字
//     的视觉效果,不需要再过引擎,直接 updateOverlay 即可。
function TextBlockControls({
  item,
  page,
  updateOverlay,
}: {
  item: TextBlockItem;
  page: PageMeta | null;
  updateOverlay: (id: string, patch: Partial<OverlayItem>) => void;
}) {
  const { commit } = useCommitTextBlock();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const align: TextAlign = item.align || 'left';

  function flush() {
    const el = editorRef.current;
    if (!el) return;
    const { text, segments } = extractSegments(el);
    setDirty(false);
    if (!page) return;
    if (text === item.text && segments === undefined) return;
    commit({ block: item, pageIndex: page.index, newText: text, segments });
  }

  return (
    <div className="rounded border bg-white p-2">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">
        原文本块
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <span className="flex items-center justify-between text-xs text-gray-600">
            <span>文字内容</span>
            {dirty && (
              <span className="text-[10px] text-amber-700">未提交</span>
            )}
          </span>
          <div className="mt-1">
            <RichTextEditor
              key={item.id}
              editorRef={editorRef}
              initialText={item.text}
              initialSegments={item.segments}
              font={item.font}
              fontSize={item.fontSize}
              color={item.color || '#000000'}
              bold={item.bold}
              italic={item.italic}
              onInput={() => setDirty(true)}
              onBlur={flush}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-gray-500">
            <span>提交: 失焦或 Ctrl+Enter · 取消: Esc</span>
            <button
              type="button"
              onClick={() => editorRef.current?.blur()}
              disabled={!dirty}
              className={clsx(
                'rounded border px-2 py-0.5 text-[10px]',
                dirty
                  ? 'border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100'
                  : 'border-gray-200 bg-gray-50 text-gray-400'
              )}
            >
              提交
            </button>
          </div>
        </div>

        <label className="flex flex-col gap-1 text-xs text-gray-600">
          字体
          <FontSelector
            value={item.font}
            onChange={(font) => updateOverlay(item.id, { font } as Partial<OverlayItem>)}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-gray-600">
          字号
          <input
            type="number"
            min={6}
            max={144}
            value={item.fontSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) {
                updateOverlay(item.id, {
                  fontSize: Math.max(6, Math.min(144, v)),
                } as Partial<OverlayItem>);
              }
            }}
            className="rounded border px-1 py-0.5"
          />
        </label>

        <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
          颜色
          <input
            type="color"
            value={item.color || '#000000'}
            onChange={(e) =>
              updateOverlay(item.id, { color: e.target.value } as Partial<OverlayItem>)
            }
            className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-gray-600">
          行距
          <input
            type="number"
            min={0.5}
            max={5}
            step={0.05}
            value={item.lineHeight ?? 1.2}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) {
                updateOverlay(item.id, {
                  lineHeight: Math.max(0.5, Math.min(5, v)),
                } as Partial<OverlayItem>);
              }
            }}
            className="rounded border px-1 py-0.5"
          />
        </label>

        {/* Phase 4: alignment buttons */}
        <div className="flex items-center gap-1">
          <AlignButtonGroup
            align={align}
            onChange={(a) => updateOverlay(item.id, { align: a } as Partial<OverlayItem>)}
          />
        </div>
      </div>
    </div>
  );
}
