// Viewer: renders the current page from a PDF.js document and hosts the
// overlay layer + tool interaction layer. Toolbar is rendered above.
import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { renderPage } from '../../core/pdf/renderer';
import { useEditorStore, ZOOM_LEVELS } from '../../store/editorStore';
import { useDocumentStore } from '../../store/documentStore';
import type { PageMeta } from '../../core/types';
import { OverlayLayer } from '../overlays/OverlayLayer';
import { CanvasInteractionLayer } from './CanvasInteractionLayer';
import { FormFieldOverlay } from '../forms/FormFieldOverlay';
import { TextBlockEditLayer } from '../text-edit/TextBlockEditLayer';

export interface ViewerProps {
  doc: PDFDocumentProxy | null;
  onOpenFile: (file: File) => void;
  /** Reserved for future use; currently the image picker is opened by
   *  CanvasInteractionLayer in response to a window event. */
  onPickImage?: () => void;
  /** Reserved for future use; the signature modal is owned by the App. */
  onOpenSignature?: () => void;
}

function rotatedSize(page: PageMeta): { width: number; height: number } {
  if (page.rotation === 90 || page.rotation === 270) {
    return { width: page.height, height: page.width };
  }
  return { width: page.width, height: page.height };
}

export function Viewer({ doc, onOpenFile }: ViewerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  const currentPageIndex = useEditorStore((s) => s.currentPageIndex);
  const zoom = useEditorStore((s) => s.zoom);
  const totalPages = useEditorStore((s) => s.totalPages);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const setZoom = useEditorStore((s) => s.setZoom);
  const nextPage = useEditorStore((s) => s.nextPage);
  const prevPage = useEditorStore((s) => s.prevPage);
  const zoomIn = useEditorStore((s) => s.zoomIn);
  const zoomOut = useEditorStore((s) => s.zoomOut);
  const setSelectedOverlayId = useEditorStore((s) => s.setSelectedOverlayId);

  const pages = useDocumentStore((s) => s.pages);
  const overlays = useDocumentStore((s) => s.overlays);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        nextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        prevPage();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoom(1);
      } else if (e.key === 'Escape') {
        setSelectedOverlayId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextPage, prevPage, zoomIn, zoomOut, setZoom, setSelectedOverlayId]);

  // Determine which page to render overlays for.
  const overlayPage: PageMeta | undefined =
    pages[Math.min(currentPageIndex, Math.max(0, pages.length - 1))];

  // Render current page at current zoom + page rotation.
  useEffect(() => {
    let cancelled = false;
    async function draw() {
      if (!doc || !canvasRef.current || !overlayPage) return;
      const pageNumber = currentPageIndex + 1;
      if (pageNumber < 1 || pageNumber > doc.numPages) return;
      const page: PDFPageProxy = await doc.getPage(pageNumber);
      if (cancelled) {
        page.cleanup();
        return;
      }
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
        renderTaskRef.current = null;
      }
      try {
        await renderPage(page, canvasRef.current, {
          scale: zoom,
          rotation: overlayPage.rotation,
        });
      } catch (err) {
        if (err instanceof Error && /cancelled/i.test(err.message)) return;
        throw err;
      }
      page.cleanup();
    }
    draw().catch((err) => {
      if (err instanceof Error && /cancelled/i.test(err.message)) return;
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [doc, currentPageIndex, zoom, overlayPage?.rotation]);

  // Hand the file input ref to the interaction layer.
  function registerFileInput(_el: HTMLInputElement | null) {
    // The interaction layer owns its own file input and opens it via a
    // global event; this hook is kept for API symmetry / future use.
  }

  const fileButton = (
    <label className="cursor-pointer rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700">
      选择 PDF
      <input
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setLoading(true);
            setError(null);
            try {
              onOpenFile(f);
            } finally {
              setLoading(false);
            }
          }
        }}
      />
    </label>
  );

  const isPdfPage =
    !!doc && !!overlayPage && currentPageIndex + 1 <= doc.numPages;
  const { width: renderW, height: renderH } = overlayPage
    ? rotatedSize(overlayPage)
    : { width: 0, height: 0 };

  return (
    <div className="flex h-full w-full flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-2">
        {fileButton}

        {doc && (
          <>
            <div className="flex items-center gap-1 text-sm">
              <button
                type="button"
                onClick={prevPage}
                disabled={currentPageIndex === 0}
                className="rounded border px-2 py-0.5 hover:bg-gray-100 disabled:opacity-50"
              >
                ← 上一页
              </button>
              <input
                type="number"
                min={1}
                max={Math.max(1, totalPages)}
                value={currentPageIndex + 1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setCurrentPage(v - 1);
                }}
                className="w-14 rounded border px-1 py-0.5 text-center"
              />
              <span className="text-gray-600">/ {totalPages}</span>
              <button
                type="button"
                onClick={nextPage}
                disabled={currentPageIndex >= totalPages - 1}
                className="rounded border px-2 py-0.5 hover:bg-gray-100 disabled:opacity-50"
              >
                下一页 →
              </button>
            </div>

            <div className="flex items-center gap-1 text-sm">
              <span className="text-gray-600">缩放</span>
              <button
                type="button"
                onClick={zoomOut}
                className="rounded border px-2 py-0.5 hover:bg-gray-100"
              >
                −
              </button>
              {ZOOM_LEVELS.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setZoom(z)}
                  className={
                    'rounded border px-2 py-0.5 hover:bg-gray-100' +
                    (Math.abs(zoom - z) < 0.001 ? ' bg-blue-100 border-blue-400' : '')
                  }
                >
                  {Math.round(z * 100)}%
                </button>
              ))}
              <button
                type="button"
                onClick={zoomIn}
                className="rounded border px-2 py-0.5 hover:bg-gray-100"
              >
                +
              </button>
              <span className="text-gray-500">{Math.round(zoom * 100)}%</span>
            </div>
          </>
        )}

        {overlays.length > 0 && (
          <span className="text-xs text-gray-500">{overlays.length} 个叠加元素</span>
        )}

        {loading && <div className="text-sm text-gray-500">加载中...</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>

      <div className="flex-1 overflow-auto bg-gray-100">
        {overlayPage && (
          <div
            className="relative inline-block"
            style={{
              width: renderW * zoom,
              height: renderH * zoom,
            }}
          >
            {isPdfPage ? (
              <canvas
                ref={canvasRef}
                className="bg-white shadow"
                style={{
                  transform: `rotate(${overlayPage.rotation}deg)`,
                  transformOrigin: 'center center',
                }}
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center border border-dashed border-gray-300 bg-white text-sm text-gray-400"
              >
                空白页 (A4 595×842)
              </div>
            )}
            <div
              className="absolute inset-0"
              style={{
                width: renderW * zoom,
                height: renderH * zoom,
                transform:
                  overlayPage.rotation === 0
                    ? undefined
                    : `rotate(${overlayPage.rotation}deg)`,
                transformOrigin: 'center center',
              }}
            >
              <div
                style={{
                  width: overlayPage.width * zoom,
                  height: overlayPage.height * zoom,
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <OverlayLayer page={overlayPage} />
                <FormFieldOverlay page={overlayPage} />
                <TextBlockEditLayer page={overlayPage} />
                <CanvasInteractionLayer
                  page={overlayPage}
                  registerFileInput={registerFileInput}
                />
              </div>
            </div>
          </div>
        )}
        {!overlayPage && (
          <div className="p-8 text-center text-sm text-gray-500">
            打开 PDF 文件后即可开始编辑。
          </div>
        )}
      </div>
    </div>
  );
}
