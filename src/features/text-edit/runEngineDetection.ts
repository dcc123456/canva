// features/text-edit/runEngineDetection.ts
//
// Orchestrates engine-driven detection (text blocks for `edit-text`, form
// fields for `form`) and writes results into documentStore / engineStore.
// Extracted from ToolSidebar so the same logic can be triggered automatically
// when a PDF is opened with the `edit-text` tool active.
import { detectTextBlocksForPage } from './detectTextBlocks';
import { detectFormFields } from '../forms/detectFormFields';
import { useDocumentStore } from '../../store/documentStore';
import { useEditorStore } from '../../store/editorStore';
import { useEngineStore } from '../../store/engineStore';
import { toast } from '../../utils/toast';
import { loadDocument } from '../../core/pdf/loader';
import { extractTextColors, matchColorsToBlocks } from '../../core/pdf/textColor';

export type DetectionKind = 'edit-text' | 'form';

/**
 * Run engine detection for the given kind. For `edit-text`, detects text
 * blocks for the current page (wiping previous text-block overlays for that
 * page first). For `form`, detects form fields across all pages.
 *
 * Updates the engineStore detection UI state (progress / label / status) so
 * the TopBar LoadingOverlay reflects progress.
 */
export async function runEngineDetection(t: DetectionKind): Promise<void> {
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

      // Phase B: 颜色抽取 -- 用 pdfjs getOperatorList 获取文字真实颜色,
      // 按 y-up <-> y-down 位置匹配到 MuPDF 检测的 block。
      if (blocks.length > 0) {
        try {
          const pdfjsDoc = await loadDocument(safeBytes);
          const pdfjsPage = await pdfjsDoc.getPage(pageIndex + 1);
          const viewport = pdfjsPage.getViewport({ scale: 1 });
          const coloredTexts = await extractTextColors(pdfjsPage);
          const colorMap = matchColorsToBlocks(
            coloredTexts,
            blocks.map((b) => ({ id: b.id, bbox: b.bbox })),
            viewport.height
          );
          for (const b of blocks) {
            const c = colorMap.get(b.id);
            if (c) b.color = c;
          }
          pdfjsPage.cleanup();
          await pdfjsDoc.cleanup();
        } catch (err) {
          console.warn(
            '[runEngineDetection] 颜色抽取失败,使用默认颜色:',
            err
          );
        }
      }

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
            align: b.align,
            segments: b.segments,
            originalSegments: b.segments,
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
