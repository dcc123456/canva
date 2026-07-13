// Toolbar: tool palette, page navigation, and pen options.
// Tools are wired to editorStore.setTool; shortcuts come from useKeyboardShortcuts.
import { useState } from 'react';
import clsx from 'clsx';
import { useEditorStore } from '../store/editorStore';
import { useDocumentStore } from '../store/documentStore';
import { useEngineStore } from '../store/engineStore';
import { useHistoryStore } from '../store/historyStore';
import type { Tool } from '../core/types';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { usePenStore } from '../store/penStore';
import { exportPdf } from '../features/export/exportPdf';
import { saveProject } from '../features/project-io/saveProject';
import { loadProject } from '../features/project-io/loadProject';
import { detectTextBlocksForPage } from '../features/text-edit/detectTextBlocks';
import { detectFormFields } from '../features/forms/detectFormFields';
import { LoadingOverlay } from './LoadingOverlay';
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

export interface ToolbarProps {
  onPickImage: () => void;
  onOpenSignature: () => void;
  /** Called after `loadProject` finishes, so the parent can re-bind the
   *  pdfjs document to its viewer. */
  onProjectLoaded?: () => void;
  onOpenTemplates?: () => void;
}

export function Toolbar({
  onPickImage,
  onOpenSignature,
  onProjectLoaded,
  onOpenTemplates,
}: ToolbarProps) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const totalPages = useEditorStore((s) => s.totalPages);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const addPage = useDocumentStore((s) => s.addPage);
  const totalDocumentPages = useDocumentStore((s) => s.pages.length);

  const penColor = usePenStore((s) => s.color);
  const penWidth = usePenStore((s) => s.width);
  const setPenColor = usePenStore((s) => s.setColor);
  const setPenWidth = usePenStore((s) => s.setWidth);

  const pastLen = useHistoryStore((s) => s.past.length);
  const futureLen = useHistoryStore((s) => s.future.length);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  // Page jump input state.
  const [editingPage, setEditingPage] = useState(false);
  const [pageDraft, setPageDraft] = useState(String(currentPageIndex + 1));

  // Export / project IO state.
  const [busyPhase, setBusyPhase] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Wire up global keyboard shortcuts.
  useKeyboardShortcuts();

  // Engine overlay state for the F10 / F11 tools.
  const mupdfLoading = useEngineStore((s) => s.mupdfLoading);
  const mupdfError = useEngineStore((s) => s.mupdfError);
  const [overlayProgress, setOverlayProgress] = useState(0);
  const [overlayLabel, setOverlayLabel] = useState<string>('初始化');
  const [showOverlay, setShowOverlay] = useState(false);
  const [engineStatus, setEngineStatus] = useState<string | null>(null);

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
    if (!pdfBytes || pages.length === 0) {
      setEngineStatus('请先打开 PDF');
      window.setTimeout(() => setEngineStatus(null), 3000);
      return;
    }
    setShowOverlay(true);
    setOverlayProgress(0);
    setOverlayLabel('初始化引擎');
    setEngineStatus(null);
    try {
      // Defensive copy: even though setPdfBytes already clones, several
      // prior code paths (project load, template apply) may have stored
      // bytes whose underlying ArrayBuffer has since been transferred to
      // a pdfjs worker and detached. Cloning here guarantees a fresh
      // ArrayBuffer for the engine call.
      const safeBytes = new Uint8Array(pdfBytes);
      if (t === 'edit-text') {
        const pageIndex = useEditorStore.getState().currentPageIndex;
        // Wipe previous text-block overlays for this page so detection
        // is idempotent.
        const currentPage = pages[pageIndex];
        if (currentPage) {
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
            setOverlayProgress(p);
            if (label) setOverlayLabel(label);
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
            });
          }
        }
        setEngineStatus(`检测到 ${blocks.length} 个文本块`);
      } else {
        // form
        const fields = await detectFormFields({
          pdfBytes: safeBytes,
          onProgress: (p, label) => {
            setOverlayProgress(p);
            if (label) setOverlayLabel(label);
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
        setEngineStatus(`检测到 ${fields.length} 个表单字段`);
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setEngineStatus(`引擎调用失败: ${msg}`);
      toast.error(`引擎调用失败: ${msg}`);
    } finally {
      setOverlayProgress(1);
      setOverlayLabel('完成');
      window.setTimeout(() => setShowOverlay(false), 400);
      window.setTimeout(() => setEngineStatus(null), 3000);
    }
  }

  async function handleExport() {
    setStatusMsg(null);
    setBusyPhase('load');
    try {
      const result = await exportPdf((p) => setBusyPhase(p.phase));
      setStatusMsg(`已导出 ${result.filename} (${result.bytes} B)`);
      toast.success('PDF 已导出');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMsg(`导出失败: ${msg}`);
      toast.error(`导出失败: ${msg}`);
    } finally {
      setBusyPhase(null);
      window.setTimeout(() => setStatusMsg(null), 4000);
    }
  }

  function handleSaveProject() {
    try {
      const result = saveProject();
      setStatusMsg(`已保存 ${result.filename} (${result.bytes} B)`);
    } catch (err) {
      setStatusMsg(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      window.setTimeout(() => setStatusMsg(null), 4000);
    }
  }

  async function handleOpenProject() {
    try {
      await loadProject({ onPdfJsDoc: () => onProjectLoaded?.() });
      setStatusMsg('项目已加载');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/cancel/i.test(msg)) {
        setStatusMsg(`打开失败: ${msg}`);
      }
    } finally {
      window.setTimeout(() => setStatusMsg(null), 4000);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-gray-50 px-2 py-1 text-sm">
      <div className="flex items-center gap-0.5">
        {TOOLS.map((t) => {
          const isActive = tool === t.tool;
          return (
            <button
              key={t.tool}
              type="button"
              title={`${t.label} (${t.shortcut})`}
              onClick={() => pickTool(t.tool)}
              className={clsx(
                'flex h-8 items-center gap-1 rounded border px-2 text-xs transition',
                isActive
                  ? 'border-blue-500 bg-blue-100 text-blue-800'
                  : 'border-transparent bg-white text-gray-700 hover:bg-gray-100'
              )}
            >
              <span className="font-semibold">{t.shortcut}</span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mx-2 h-6 w-px bg-gray-300" />

      {tool === 'draw' && (
        <div className="flex items-center gap-2 rounded border bg-white px-2 py-1">
          <label className="flex items-center gap-1 text-xs text-gray-600">
            颜色
            <input
              type="color"
              value={penColor}
              onChange={(e) => setPenColor(e.target.value)}
              className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-600">
            粗细
            <input
              type="range"
              min={1}
              max={12}
              step={0.5}
              value={penWidth}
              onChange={(e) => setPenWidth(Number(e.target.value))}
            />
            <span className="w-6 text-right tabular-nums">{penWidth}</span>
          </label>
        </div>
      )}

      <div className="mx-2 h-6 w-px bg-gray-300" />

      <div className="flex items-center gap-1 text-xs text-gray-700">
        <button
          type="button"
          title="撤销 (Ctrl/Cmd+Z)"
          onClick={undo}
          disabled={pastLen === 0}
          className="rounded border px-2 py-0.5 enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↶
        </button>
        <button
          type="button"
          title="重做 (Ctrl/Cmd+Shift+Z)"
          onClick={redo}
          disabled={futureLen === 0}
          className="rounded border px-2 py-0.5 enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ↷
        </button>
      </div>

      <div className="mx-2 h-6 w-px bg-gray-300" />

      <div className="flex items-center gap-1 text-xs text-gray-700">
        <span>页</span>
        {editingPage ? (
          <input
            type="number"
            min={1}
            max={Math.max(1, totalPages)}
            autoFocus
            value={pageDraft}
            onChange={(e) => setPageDraft(e.target.value)}
            onBlur={() => {
              const v = Number(pageDraft);
              if (Number.isFinite(v)) setCurrentPage(v - 1);
              setEditingPage(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                setEditingPage(false);
              }
            }}
            className="w-14 rounded border px-1 py-0.5 text-center"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => {
              setPageDraft(String(currentPageIndex + 1));
              setEditingPage(true);
            }}
            title="双击输入页码跳转"
            className="rounded border px-2 py-0.5 hover:bg-gray-100"
          >
            {currentPageIndex + 1} / {Math.max(1, totalPages)}
          </button>
        )}
        <button
          type="button"
          onClick={() => addPage()}
          title="新增一张 A4 空白页"
          className="rounded border px-2 py-0.5 hover:bg-gray-100"
        >
          + 新建页
        </button>
        <span className="ml-1 text-gray-500">共 {totalDocumentPages} 页</span>
      </div>

      <div className="mx-2 h-6 w-px bg-gray-300" />

      <div className="flex items-center gap-1 text-xs text-gray-700">
        <button
          type="button"
          onClick={onOpenTemplates}
          title="选择模板快速开始 (?)"
          data-toolbar-action="templates"
          className="rounded border px-2 py-0.5 hover:bg-gray-100"
        >
          📚 模板
        </button>
        <button
          type="button"
          onClick={handleSaveProject}
          title="保存项目 (.minipdf.json)"
          className="rounded border px-2 py-0.5 hover:bg-gray-100"
        >
          保存项目
        </button>
        <button
          type="button"
          onClick={handleOpenProject}
          title="打开项目 (.minipdf.json)"
          className="rounded border px-2 py-0.5 hover:bg-gray-100"
        >
          打开项目
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={busyPhase !== null}
          title="导出 PDF"
          className="rounded border bg-blue-600 px-2 py-0.5 text-white enabled:hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyPhase ? `导出中… (${busyPhase})` : '导出 PDF'}
        </button>
        {statusMsg && (
          <span className="ml-1 text-gray-500">{statusMsg}</span>
        )}
        {engineStatus && (
          <span className="ml-1 text-gray-500">{engineStatus}</span>
        )}
      </div>
      <LoadingOverlay
        visible={showOverlay || mupdfLoading}
        progress={overlayProgress}
        label={overlayLabel}
        error={mupdfError}
        onDismiss={() => {
          setShowOverlay(false);
          useEngineStore.getState().setMupdfError(null);
        }}
      />
    </div>
  );
}
