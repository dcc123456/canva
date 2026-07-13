// core/writer/textBlockEdits.ts
//
// 导出时把"被编辑过的 text-block"(text !== originalText)统一应用到
// PDFDocument。这是重构后的单一管线核心:
//   1. 用 MuPDF 从干净的原 pdfBytes 收集原字的字符级 quad
//   2. 用 pdf-lib 按字符 quad 画白底(精确覆盖原字,不伤相邻文字)
//   3. 用 pdf-lib 在原 baseline 画新字(CJK 用 fontkit + Source Han Sans)
//
// 关键:pdfBytes 始终是干净的原 PDF(编辑过程不改它),所以字符 quad
// 永远对得上。画布与导出用同一套"原字 + 白底 + 新字"模型,不再有
// 两套路径不一致的问题。
import { PDFDocument, PDFPage, rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PageMeta, TextBlockItem } from '../types';
import { hexToRgb, pickStandardFont } from './helpers';
import { loadCjkFontBytes, containsNonAscii } from './cjkFont';
import { collectWhiteoutQuads, type Quad } from './textQuad';

export interface ApplyTextBlockEditsOptions {
  /** 已通过 applyPages 处理好页面顺序/旋转的 PDFDocument。 */
  doc: PDFDocument;
  /** 干净的原 PDF 字节(编辑过程从未改写),用于收集字符 quad。 */
  originalBytes: Uint8Array;
  pages: PageMeta[];
  /** 仅 text !== originalText 的 text-block。 */
  textBlocks: TextBlockItem[];
}

/**
 * 对每个被编辑的 text-block:
 *   - 从原 PDF 收集原字字符 quad
 *   - 按字符 quad 画白底(带少量 padding 确保盖全)
 *   - 在原 baseline 画新字
 */
export async function applyTextBlockEdits(
  options: ApplyTextBlockEditsOptions
): Promise<void> {
  const { doc, originalBytes, pages, textBlocks } = options;
  if (textBlocks.length === 0) return;

  // 字体缓存:同一字体只 embed 一次。
  const fontCache = new Map<string, PDFFont>();
  let cjkFont: PDFFont | null = null;
  let cjkFontAttempted = false;

  async function getFont(text: string): Promise<{ font: PDFFont; safe: string }> {
    const needsCjk = containsNonAscii(text);
    if (needsCjk) {
      if (!cjkFontAttempted) {
        cjkFontAttempted = true;
        doc.registerFontkit(fontkit);
        const bytes = await loadCjkFontBytes();
        if (bytes) {
          // subset: false -- 嵌入完整字体。subset: true 在 save 时可能
          // 没有正确包含使用到的中文字符,导致 PDF 阅读器看到空字体。
          cjkFont = await doc.embedFont(bytes, { subset: false });
        }
      }
      if (cjkFont) {
        return { font: cjkFont, safe: text };
      }
      // CJK 字体不可用 -- 降级为 ASCII,非 ASCII 字符替换为 '?'。
      const fallbackName = pickStandardFont('Helvetica', false, false);
      let f = fontCache.get(fallbackName);
      if (!f) {
        f = await doc.embedFont(fallbackName);
        fontCache.set(fallbackName, f);
      }
      let safe = '';
      for (const ch of text) {
        safe += (ch.codePointAt(0) ?? 0) > 0x7e ? '?' : ch;
      }
      return { font: f, safe };
    }
    // 纯 ASCII:用 StandardFonts。
    const name = pickStandardFont('Helvetica', false, false);
    let f = fontCache.get(name);
    if (!f) {
      f = await doc.embedFont(name);
      fontCache.set(name, f);
    }
    return { font: f, safe: text };
  }

  for (const block of textBlocks) {
    const editorPageIndex = pages.findIndex((p) => p.id === block.pageId);
    if (editorPageIndex < 0) continue;
    const meta = pages[editorPageIndex];
    // 原始 PDF 页码(1-based for pdfjs/mupdf, 0-based for pdf-lib).
    // meta.index 是 0-based 原始页码;collectWhiteoutQuads 用 0-based。
    const originalPageIndex = meta.isBlank ? -1 : meta.index;
    if (originalPageIndex < 0) {
      // 空白页上不应该有 text-block,跳过。
      continue;
    }

    const page: PDFPage = doc.getPage(editorPageIndex);
    const pageHeight = page.getHeight();
    const { r, g, b } = hexToRgb(block.color || '#000000');
    const white = rgb(1, 1, 1);
    const fontSize = Math.max(block.fontSize, 6);

    // (1) 收集原字字符 quad(从干净原 PDF,在 originalBbox 位置)。
    //     originalBbox 是检测时的原始位置,原字在那里;移动后 bbox !=
    //     originalBbox,白底要盖旧位置,新字画在新 bbox 位置。
    const quads: Quad[] = await collectWhiteoutQuads(
      new Uint8Array(originalBytes),
      originalPageIndex,
      block.originalBbox
    );

    // (2) 按字符 quad 画白底。stext 给出 y-down 顶左坐标系,
    // pdf-lib drawRectangle 用 y-up 底左。
    for (const q of quads) {
      const padY = Math.max(1, q.h * 0.1);
      const padX = 0.5;
      const yPdf = pageHeight - q.y - q.h - padY;
      page.drawRectangle({
        x: q.x - padX,
        y: yPdf,
        width: q.w + 2 * padX,
        height: q.h + 2 * padY,
        color: white,
        borderWidth: 0,
        opacity: 1,
      });
    }

    // (3) 画新字。baseline 锚在 bbox 底部。
    if (!block.text) continue;
    const { font, safe } = await getFont(block.text);
    const baseline = pageHeight - block.bbox.y - fontSize;
    try {
      page.drawText(safe, {
        x: block.bbox.x,
        y: baseline,
        size: fontSize,
        font,
        color: rgb(r, g, b),
        maxWidth: block.bbox.w,
      });
    } catch (err) {
      // drawText 失败通常是字体不支持某码位。用 '?' 替换非 ASCII
      // 字符后用 Helvetica 兜底重试,避免文字完全空白。
      // eslint-disable-next-line no-console
      console.warn(
        '[textBlockEdits] drawText 失败,用 ? 兜底重试 block %s:',
        block.id,
        err
      );
      try {
        const fallbackName = pickStandardFont('Helvetica', false, false);
        let fb = fontCache.get(fallbackName);
        if (!fb) {
          fb = await doc.embedFont(fallbackName);
          fontCache.set(fallbackName, fb);
        }
        let safeAscii = '';
        for (const ch of safe) {
          safeAscii += (ch.codePointAt(0) ?? 0) > 0x7e ? '?' : ch;
        }
        page.drawText(safeAscii, {
          x: block.bbox.x,
          y: baseline,
          size: fontSize,
          font: fb,
          color: rgb(r, g, b),
          maxWidth: block.bbox.w,
        });
      } catch (err2) {
        // eslint-disable-next-line no-console
        console.error(
          '[textBlockEdits] 兜底 drawText 也失败,跳过 block %s:',
          block.id,
          err2
        );
      }
    }
  }
}
