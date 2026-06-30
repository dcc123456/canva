import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { v4 as uuidv4 } from 'uuid';
import { Viewer } from './features/viewer/Viewer';
import { Sidebar } from './features/viewer/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Inspector } from './components/Inspector';
import { SignatureDialog } from './components/SignatureDialog';
import { TemplateGallery } from './features/templates/TemplateGallery';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from './components/Toaster';
import { ShortcutsModal } from './components/ShortcutsModal';
import { EmptyState } from './components/EmptyState';
import { pdfjsLib } from './core/pdf/loader';
import { applyTheme, getStoredTheme, type Theme } from './utils/theme';
import { useDocumentStore } from './store/documentStore';
import { useEditorStore } from './store/editorStore';
import { useTemplateStore } from './store/templateStore';
import { useEngineStore } from './store/engineStore';
import { useHistoryStore } from './store/historyStore';
import type { PageMeta } from './core/types';
import { toast } from './utils/toast';

function App() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  // Touch all stores so they are constructed on app load.
  useDocumentStore.getState();
  useEditorStore.getState();
  useTemplateStore.getState();
  useEngineStore.getState();
  useHistoryStore.getState();

  // Global "?" opens the shortcuts panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 当 store.pdfBytes 被引擎(MuPDF / PDFium / 兜底)写回时,我们需要
  // 让 pdfjs 拿到的 PDFDocumentProxy 与字节流同步。两个触发口径:
  //   * commit 时显式 dispatch `canva:pdf-bytes-replaced`,这里清掉 doc;
  //   * 这个 effect 注意到 doc===null && store.pdfBytes!==null 时
  //     自动 loadDocument 重建 doc。
  // 没有这层同步,画布会一直显示创建 doc 时的快照,看起来"页面没变"。
  useEffect(() => {
    const handler = () => setDoc(null);
    window.addEventListener('canva:pdf-bytes-replaced', handler);
    return () => window.removeEventListener('canva:pdf-bytes-replaced', handler);
  }, []);

  useEffect(() => {
    if (doc !== null) return;
    const bytes = useDocumentStore.getState().pdfBytes;
    if (!bytes) return;
    let cancelled = false;
    (async () => {
      try {
        // pdfjs 在内部会 transfer 这个 buffer;给它一份 clone 避免
        // 影响 store 里的原始字节(后续仍可能再次写回)。
        const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
        const next = await task.promise;
        if (!cancelled) {
          setDoc(next);
          // eslint-disable-next-line no-console
          console.log(
            '[App] pdfjs document reloaded from %d bytes, %d pages',
            bytes.byteLength,
            next.numPages
          );
        }
      } catch (err) {
        console.error('[App] reload pdfjs document after bytes change failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  async function handleOpenFile(file: File) {
    setBusy(true);
    setError(null);
    setProgress({ loaded: 0, total: 1 });
    try {
      const buffer = await file.arrayBuffer();
      const sharedView = new Uint8Array(buffer);
      const pdfBytes = new Uint8Array(sharedView);
      const document = await loadDocumentWithProgress(
        sharedView,
        (p) => setProgress(p)
      );
      const newPages: PageMeta[] = [];
      for (let i = 1; i <= document.numPages; i += 1) {
        const p = await document.getPage(i);
        const viewport = p.getViewport({ scale: 1 });
        newPages.push({
          id: uuidv4(),
          index: i - 1,
          rotation: 0,
          width: viewport.width,
          height: viewport.height,
        });
        p.cleanup();
      }
      setDoc(document);
      const setPages = useDocumentStore.getState().setPages;
      const setPdfBytes = useDocumentStore.getState().setPdfBytes;
      const setPdfName = useDocumentStore.getState().setPdfName;
      const setTotalPages = useEditorStore.getState().setTotalPages;
      const setCurrentPage = useEditorStore.getState().setCurrentPage;
      setPages(newPages);
      setPdfBytes(pdfBytes);
      setPdfName(file.name);
      setTotalPages(document.numPages);
      setCurrentPage(0);
      toast.success(`已打开 ${file.name}`);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`打开失败: ${msg}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // Toolbar's "图片" button asks the CanvasInteractionLayer to open its
  // hidden file input via this window event.
  function pickImage() {
    window.dispatchEvent(new CustomEvent('canva:open-image-picker'));
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen flex-col bg-white text-gray-900">
        <header className="flex items-center justify-between border-b bg-gray-50 px-4 py-2">
          <div className="text-base font-semibold">Mini PDF 编辑器</div>
          <div className="text-xs text-gray-500">
            F2 注释 · F3 文字 · F4 图片 · F5 页面 · F6 画笔/签名 · F12 模板
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              title="查看快捷键 (?)"
              className="rounded border bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
            >
              ?
            </button>
            <button
              type="button"
              onClick={() => {
                const next: Theme = theme === 'dark' ? 'light' : 'dark';
                setTheme(next);
                applyTheme(next);
                try {
                  localStorage.setItem('canva.theme', next);
                } catch {
                  /* ignore */
                }
              }}
              title="切换暗色 / 亮色主题"
              className="rounded border bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
            >
              {theme === 'dark' ? '☀ 亮' : '🌙 暗'}
            </button>
          </div>
          {error && <div className="text-xs text-red-600">{error}</div>}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {progress && progress.total > 0 ? (
                <>
                  <span>加载中...</span>
                  <div className="h-1 w-32 overflow-hidden rounded bg-gray-200">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{
                        width: `${Math.round((progress.loaded / progress.total) * 100)}%`,
                      }}
                    />
                  </div>
                </>
              ) : (
                <span>加载中...</span>
              )}
            </div>
          )}
        </header>
        <Toolbar
          onPickImage={pickImage}
          onOpenSignature={() => setSignatureOpen(true)}
          onOpenTemplates={() => setTemplatesOpen(true)}
          onProjectLoaded={() => {
            // The viewer needs a fresh pdfjs document; clear the existing
            // one so the next render reloads from the current store bytes.
            setDoc(null);
          }}
        />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar doc={doc} />
          <main className="flex-1 overflow-hidden">
            <PdfOrEmpty doc={doc} onOpenFile={handleOpenFile} />
          </main>
          <Inspector />
        </div>
        <SignatureDialog
          open={signatureOpen}
          onClose={() => setSignatureOpen(false)}
        />
        <TemplateGallery
          open={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
          onApplied={(r) => {
            toast.success(`已应用模板: ${r.name}`);
            setDoc(null);
          }}
        />
        <ShortcutsModal
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />
        <Toaster />
        <ShortcutsOpener onOpen={() => setShortcutsOpen(true)} />
        <DocumentReplacedListener
          onReplace={() => {
            setDoc(null);
          }}
        />
      </div>
    </ErrorBoundary>
  );
}

/**
 * Wrap the Viewer with an empty-state component: when no PDF has been
 * opened yet (or after a reset), the user sees three CTAs (template /
 * open / new blank doc).
 */
function PdfOrEmpty({
  doc,
  onOpenFile,
}: {
  doc: PDFDocumentProxy | null;
  onOpenFile: (file: File) => void;
}) {
  const pdfBytes = useDocumentStore((s) => s.pdfBytes);
  const pages = useDocumentStore((s) => s.pages);
  const isEmpty = pdfBytes === null && pages.length === 0;
  if (isEmpty) {
    return (
      <EmptyState
        onOpenFile={onOpenFile}
        onNewBlank={() => {
          // Set a single blank A4 page without bytes — Viewer will draw the
          // blank placeholder. This is enough to start typing / drawing.
          useDocumentStore.getState().setPages([
            {
              id: uuidv4(),
              index: 0,
              rotation: 0,
              width: 595,
              height: 842,
              isBlank: true,
            },
          ]);
          useEditorStore.getState().setTotalPages(1);
          useEditorStore.getState().setCurrentPage(0);
        }}
        onPickTemplate={() => {
          window.dispatchEvent(new CustomEvent('canva:open-templates'));
        }}
      />
    );
  }
  return <Viewer doc={doc} onOpenFile={onOpenFile} />;
}

/**
 * Listen for the global "?" keypress and tell the parent to open the modal.
 */
function ShortcutsOpener({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    const handler = () => onOpen();
    window.addEventListener('canva:open-shortcuts', handler);
    return () => window.removeEventListener('canva:open-shortcuts', handler);
  }, [onOpen]);
  return null;
}

/**
 * Listen for the document-replaced event from the template gallery and
 * clear the existing pdfjs doc so the Viewer reloads from the store.
 */
function DocumentReplacedListener({ onReplace }: { onReplace: () => void }) {
  useEffect(() => {
    const handler = () => onReplace();
    window.addEventListener('canva:document-replaced', handler);
    return () => window.removeEventListener('canva:document-replaced', handler);
  }, [onReplace]);
  return null;
}

/**
 * Wrap `loadDocument` with an `onProgress` callback by hooking into the
 * pdfjs loading task. pdfjs's `getDocument` returns a task with an
 * `onProgress` method we can attach a listener to.
 */
async function loadDocumentWithProgress(
  bytes: Uint8Array,
  onProgress: (p: { loaded: number; total: number }) => void
): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({ data: bytes });
  task.onProgress = (loaded: number, total: number) => {
    onProgress({ loaded, total });
  };
  return task.promise;
}

export default App;