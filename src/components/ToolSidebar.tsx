// ToolSidebar: vertical tool palette (left edge). Contains the 9 tool
// buttons, pen options (shown when draw is active), and the engine
// detection logic for the edit-text / form tools.
//
// Extracted from the original Toolbar.tsx. The pickTool and runEngineDetection
// functions are moved here verbatim; detection UI state is communicated to
// TopBar via the engine store.
import clsx from 'clsx';
import { useEditorStore } from '../store/editorStore';
import { useDocumentStore } from '../store/documentStore';
import { useEngineStore } from '../store/engineStore';
import { usePenStore } from '../store/penStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import type { Tool } from '../core/types';
import { detectTextBlocksForPage } from '../features/text-edit/detectTextBlocks';
import { detectFormFields } from '../features/forms/detectFormFields';
import { toast } from '../utils/toast';

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

  async function runEngineDetection(t: 'edit-text' | 'form') {
    const { pdfBytes, pages, addOverlay, removeOverlay } =
      useDocumentStore.getState();
    const eng = useEngineStore.getState();

    if (!pdfBytes || pages.length === 0) {
      eng.setEngineStatusMessage('请先打开 PDF');
      window.setTimeout(() => eng.setEngineStatusMessage(null), 3000);
      return;
    }

    eng.setDetectionVisible(true);
    eng.setDetectionProgress(0);
    eng.setDetectionLabel('初始化引擎');
    eng.setEngineStatusMessage(null);

    try {
      // Defensive copy: the underlying ArrayBuffer may have been transferred
      // to a pdfjs worker and detached. Cloning here guarantees a fresh buffer.
      const safeBytes = new Uint8Array(pdfBytes);
      if (t === 'edit-text') {
        const pageIndex = useEditorStore.getState().currentPageIndex;
        const currentPage = pages[pageIndex];
        if (currentPage) {
          // Wipe previous text-block overlays for this page so detection is idempotent.
          useDocumentStore
            .getState()
            .overlays.filter(
              (o) => o.type === 'text-block' && o.pageId === currentPage.id
            )
            .forEach((o) => removeOverlay(o.id));
        }
        const { blocks } = await detectTextBlocksForPage({
          pageIndex,
          pdfBytes: safeBytes,
          onProgress: (p, label) => {
            eng.setDetectionProgress(p);
            if (label) eng.setDetectionLabel(label);
          },
        });
        if (currentPage) {
          for (const b of blocks) {
            addOverlay({
              id: b.id,
              pageId: currentPage.id,
              type: 'text-block',
              bbox: b.bbox,
              originalBbox: b.bbox,
              originalText: b.text,
              text: b.text,
              font: b.font,
              fontSize: b.fontSize,
              color: b.color,
              lineHeight: b.lineHeight,
              bold: b.bold,
              italic: b.italic,
            });
          }
        }
        eng.setEngineStatusMessage(`检测到 ${blocks.length} 个文本块`);
      } else {
        // form detection
        const fields = await detectFormFields({
          pdfBytes: safeBytes,
          onProgress: (p, label) => {
            eng.setDetectionProgress(p);
            if (label) eng.setDetectionLabel(label);
          },
        });
        for (const f of fields) {
          const page = pages[f.pageIndex];
          if (!page) continue;
          addOverlay({
            id: f.id,
            pageId: page.id,
            type: 'form-field',
            fieldName: f.fieldName,
            kind: f.kind,
            bbox: f.bbox,
            options: f.options,
            value: f.value,
          });
        }
        eng.setEngineStatusMessage(`检测到 ${fields.length} 个表单字段`);
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      eng.setEngineStatusMessage(`引擎调用失败: ${msg}`);
      toast.error(`引擎调用失败: ${msg}`);
    } finally {
      eng.setDetectionProgress(1);
      eng.setDetectionLabel('完成');
      window.setTimeout(() => eng.setDetectionVisible(false), 400);
      window.setTimeout(() => eng.setEngineStatusMessage(null), 3000);
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
