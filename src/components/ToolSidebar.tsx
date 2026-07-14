// ToolSidebar: vertical tool palette (left edge). Contains the 9 tool
// buttons, pen options (shown when draw is active), and the engine
// detection logic for the edit-text / form tools.
//
// Extracted from the original Toolbar.tsx. The pickTool and runEngineDetection
// functions are moved here verbatim; detection UI state is communicated to
// TopBar via the engine store.
import clsx from 'clsx';
import { useEditorStore } from '../store/editorStore';
import { usePenStore } from '../store/penStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import type { Tool } from '../core/types';
import { runEngineDetection } from '../features/text-edit/runEngineDetection';
import { useAutoDetectTextBlocks } from '../features/text-edit/useAutoDetectTextBlocks';

interface ToolDef {
  tool: Tool;
  label: string;
  shortcut: string;
}

const TOOLS: ToolDef[] = [
  { tool: 'select', label: '选择', shortcut: 'V' },
  { tool: 'edit-text', label: '编辑文字', shortcut: 'E' },
  { tool: 'form', label: '表单', shortcut: 'F' },
  { tool: 'highlight', label: '高亮', shortcut: 'H' },
  { tool: 'note', label: '便签', shortcut: 'N' },
  { tool: 'text', label: '文字', shortcut: 'T' },
  { tool: 'image', label: '图片', shortcut: 'I' },
  { tool: 'draw', label: '画笔', shortcut: 'D' },
  { tool: 'signature', label: '签名', shortcut: 'S' },
];

export interface ToolSidebarProps {
  onPickImage: () => void;
  onOpenSignature: () => void;
}

export function ToolSidebar({ onPickImage, onOpenSignature }: ToolSidebarProps) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);

  const penColor = usePenStore((s) => s.color);
  const penWidth = usePenStore((s) => s.width);
  const setPenColor = usePenStore((s) => s.setColor);
  const setPenWidth = usePenStore((s) => s.setWidth);

  // Wire up global keyboard shortcuts (tool switching, undo/redo, delete, esc).
  useKeyboardShortcuts();

  // Auto-run text-block detection when edit-text is active and the current
  // page hasn't been detected yet (default tool is edit-text).
  useAutoDetectTextBlocks();

  function pickTool(t: Tool) {
    if (t === 'image') {
      onPickImage();
      return;
    }
    if (t === 'signature') {
      onOpenSignature();
      return;
    }
    setTool(t);
    if (t === 'edit-text' || t === 'form') {
      void runEngineDetection(t);
    }
  }

  return (
    <aside className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-gray-200 bg-white py-2 dark:border-gray-700 dark:bg-gray-800">
      {TOOLS.map((t) => {
        const isActive = tool === t.tool;
        return (
          <button
            key={t.tool}
            type="button"
            title={`${t.label} (${t.shortcut})`}
            onClick={() => pickTool(t.tool)}
            className={clsx(
              'flex w-14 flex-col items-center gap-0.5 rounded-md py-1.5 transition',
              isActive
                ? 'bg-[var(--accent-light)] text-[var(--accent-text)]'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
            )}
          >
            {/* Shortcut letter as the icon glyph */}
            <span className="text-base font-bold leading-none">{t.shortcut}</span>
            <span className="text-[10px] leading-none">{t.label}</span>
          </button>
        );
      })}

      {/* Pen options: expand below tools when draw is active */}
      {tool === 'draw' && (
        <div className="mt-2 flex w-14 flex-col gap-2 rounded-md border border-gray-200 bg-gray-50 p-1.5 dark:border-gray-600 dark:bg-gray-700">
          {/* Color picker */}
          <label className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] text-gray-500 dark:text-gray-400">颜色</span>
            <input
              type="color"
              value={penColor}
              onChange={(e) => setPenColor(e.target.value)}
              className="h-6 w-10 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
          {/* Width slider */}
          <label className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] text-gray-500 dark:text-gray-400">
              粗细 {penWidth}
            </span>
            <input
              type="range"
              min={1}
              max={12}
              step={0.5}
              value={penWidth}
              onChange={(e) => setPenWidth(Number(e.target.value))}
              className="w-12"
            />
          </label>
        </div>
      )}
    </aside>
  );
}
