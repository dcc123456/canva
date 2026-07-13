// Inspector: right-side property panel for the currently selected overlay.
// - Common: X / Y / W / H / rotation + delete.
// - Text: font family (3 built-ins + Custom), size, color, bold/italic/underline.
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useDocumentStore } from '../store/documentStore';
import { useEditorStore } from '../store/editorStore';
import { useCommitTextBlock } from '../features/text-edit/useCommitTextBlock';
import type {
  DrawingItem,
  HighlightItem,
  ImageItem,
  OverlayItem,
  PageMeta,
  StickyNoteItem,
  TextBlockItem,
  TextItem,
} from '../core/types';

const BUILTIN_FONTS = ['Helvetica', 'TimesRoman', 'Courier'] as const;
type BuiltinFont = (typeof BUILTIN_FONTS)[number];
const isBuiltinFont = (s: string): s is BuiltinFont =>
  (BUILTIN_FONTS as readonly string[]).includes(s);

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
      // Drawing doesn't have a fixed bbox; skip common geometry.
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

function TextControls({
  item,
  updateOverlay,
}: {
  item: TextItem;
  updateOverlay: (id: string, patch: Partial<OverlayItem>) => void;
}) {
  const fontIsBuiltin = isBuiltinFont(item.font);
  return (
    <div className="rounded border bg-white p-2">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">文字</div>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          字体
          <select
            value={fontIsBuiltin ? item.font : 'Custom'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'Custom') {
                // Use a generic sans-serif and let the user enter a name.
                const name = window.prompt('输入字体名称', 'sans-serif') ?? 'sans-serif';
                updateOverlay(item.id, { font: name } as Partial<OverlayItem>);
              } else {
                updateOverlay(item.id, { font: v } as Partial<OverlayItem>);
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
        <div className="flex items-center gap-1">
          <ToggleButton
            active={item.bold}
            onClick={() => updateOverlay(item.id, { bold: !item.bold } as Partial<OverlayItem>)}
            title="粗体"
          >
            <b>B</b>
          </ToggleButton>
          <ToggleButton
            active={item.italic}
            onClick={() => updateOverlay(item.id, { italic: !item.italic } as Partial<OverlayItem>)}
            title="斜体"
          >
            <i>I</i>
          </ToggleButton>
          <ToggleButton
            active={item.underline}
            onClick={() => updateOverlay(item.id, { underline: !item.underline } as Partial<OverlayItem>)}
            title="下划线"
          >
            <u>U</u>
          </ToggleButton>
        </div>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          文字内容
          <textarea
            value={item.text}
            onChange={(e) =>
              updateOverlay(item.id, { text: e.target.value } as Partial<OverlayItem>)
            }
            rows={3}
            className="rounded border px-1 py-0.5"
          />
        </label>
      </div>
    </div>
  );
}

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

// ---------- TextBlockControls ----------------------------------------------
//
// Inspector 面板里的"原文本块"控件:
//   * 文字内容 textarea —— 提交时调 useCommitTextBlock,引擎(MuPDF /
//     PDFium / 兜底)真把原字节从 PDF 内容流删掉再用新文字重画。
//   * 字体 / 字号 / 颜色 —— 只影响 flatten 阶段重画新文字的视觉效果,
//     不需要再过引擎,直接 updateOverlay 即可。
//   * 引擎状态 pill —— 让用户一眼看到当前 block 是 mupdf/pdfium 真删
//     还是 pdflib-overlay 兜底。
function TextBlockControls({
  item,
  page,
  updateOverlay,
}: {
  item: TextBlockItem;
  page: PageMeta | null;
  updateOverlay: (id: string, patch: Partial<OverlayItem>) => void;
}) {
  // 文字内容用 local state 解耦,避免每次键盘输入都触发 store 更新 +
  // 全画布 re-render;只有失焦 / Ctrl+Enter 才把变更写回 PDF。
  const [draft, setDraft] = useState(item.text);
  useEffect(() => {
    // 当选中切换到别的 block,或外部有改动(画布内嵌 textarea 提交)时,
    // 同步刷新本地草稿。
    setDraft(item.text);
  }, [item.id, item.text]);

  const { commit } = useCommitTextBlock();
  const fontIsBuiltin = isBuiltinFont(item.font);
  const dirty = draft !== item.text;

  function flush() {
    if (!dirty) return;
    if (!page) return;
    commit({ block: item, pageIndex: page.index, newText: draft });
  }

  return (
    <div className="rounded border bg-white p-2">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">
        原文本块
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          <span className="flex items-center justify-between">
            <span>文字内容</span>
            {dirty && (
              <span className="text-[10px] text-amber-700">未提交</span>
            )}
          </span>
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onBlur={() => {
              flush();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                flush();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(item.text);
              }
            }}
            rows={3}
            className="rounded border px-1 py-0.5"
            placeholder="(空)"
          />
          <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
            <span>提交: 失焦或 Ctrl+Enter · 取消: Esc</span>
            <button
              type="button"
              onClick={() => {
                flush();
              }}
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
        </label>

        <label className="flex flex-col gap-1 text-xs text-gray-600">
          字体
          <select
            value={fontIsBuiltin ? item.font : 'Custom'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'Custom') {
                const name =
                  window.prompt('输入字体名称', item.font || 'sans-serif') ??
                  item.font;
                updateOverlay(item.id, { font: name } as Partial<OverlayItem>);
              } else {
                updateOverlay(item.id, { font: v } as Partial<OverlayItem>);
              }
            }}
            className="rounded border px-1 py-0.5"
          >
            {BUILTIN_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            <option value="Custom">Custom…</option>
          </select>
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
      </div>
    </div>
  );
}
