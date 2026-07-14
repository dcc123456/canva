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
import { hexToRgb, pickStandardFont, wrapText, alignedX } from './helpers';
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

  async function getFont(
    text: string,
    bold: boolean,
    italic: boolean,
    fontName = 'Helvetica'
  ): Promise<{ font: PDFFont; safe: string }> {
    const needsCjk = containsNonAscii(text);
    if (needsCjk) {
      if (!cjkFontAttempted) {
        cjkFontAttempted = true;
        doc.registerFontkit(fontkit);
        const bytes = await loadCjkFontBytes();
        if (bytes) {
          cjkFont = await doc.embedFont(bytes, { subset: false });
        }
      }
      if (cjkFont) {
        return { font: cjkFont, safe: text };
      }
      const fallbackName = pickStandardFont(fontName, bold, italic);
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
    const name = pickStandardFont(fontName, bold, italic);
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
    const originalPageIndex = meta.isBlank ? -1 : meta.index;
    if (originalPageIndex < 0) {
      continue;
    }

    const page: PDFPage = doc.getPage(editorPageIndex);
    const pageHeight = page.getHeight();
    const { r, g, b } = hexToRgb(block.color || '#000000');
    const white = rgb(1, 1, 1);
    const fontSize = Math.max(block.fontSize, 6);
    const lineHeight = block.lineHeight || 1.2;
    const align = block.align || 'left';
    const lineStep = fontSize * lineHeight;

    // (1) 收集原字字符 quad(从干净原 PDF,在 originalBbox 位置)。
    const quads: Quad[] = await collectWhiteoutQuads(
      new Uint8Array(originalBytes),
      originalPageIndex,
      block.originalBbox
    );

    // (2) 按字符 quad 画白底。
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

    // (3) 画新字。
    if (!block.text) continue;

    if (block.segments && block.segments.length > 0) {
      // Phase 6: draw segments sequentially with per-line alignment.
      type SegInfo = {
        text: string;
        font: PDFFont;
        width: number;
        color: string;
      };
      const lines: SegInfo[][] = [[]];

      for (const seg of block.segments) {
        const segBold = seg.bold ?? block.bold;
        const segItalic = seg.italic ?? block.italic;
        const segColor = seg.color || block.color;
        const parts = seg.text.split('\n');
        for (let pi = 0; pi < parts.length; pi++) {
          if (pi > 0) lines.push([]);
          const partText = parts[pi];
          if (partText) {
            try {
              const { font, safe } = await getFont(
                partText,
                segBold,
                segItalic,
                block.font
              );
              const width = font.widthOfTextAtSize(safe, fontSize);
              lines[lines.length - 1].push({
                text: safe,
                font,
                width,
                color: segColor,
              });
            } catch (err) {
              console.warn(
                '[textBlockEdits] segment getFont 失败,跳过 segment:',
                err
              );
            }
          }
        }
      }

      try {
        for (let li = 0; li < lines.length; li++) {
          const segs = lines[li];
          if (segs.length === 0) continue;
          const totalW = segs.reduce((sum, s) => sum + s.width, 0);
          let x = alignedX(align, block.bbox.x, block.bbox.w, totalW);
          const y =
            pageHeight - block.bbox.y - fontSize - li * lineStep;
          for (const s of segs) {
            const { r: sr, g: sg, b: sb } = hexToRgb(s.color);
            page.drawText(s.text, {
              x,
              y,
              size: fontSize,
              font: s.font,
              color: rgb(sr, sg, sb),
            });
            x += s.width;
          }
        }
      } catch (err) {
        console.warn(
          '[textBlockEdits] segments drawText 失败,用 ? 兜底重试 block %s:',
          block.id,
          err
        );
        await fallbackDrawText(
          doc,
          fontCache,
          page,
          pageHeight,
          block,
          fontSize,
          lineStep,
          align,
          rgb(r, g, b)
        );
      }
    } else {
      // No segments: wrap + align + multi-line.
      const { font, safe } = await getFont(
        block.text,
        block.bold,
        block.italic,
        block.font
      );

      const drawAllLines = (f: PDFFont, text: string) => {
        const wrappedLines = wrapText(f, text, block.bbox.w, fontSize);
        for (let li = 0; li < wrappedLines.length; li++) {
          const lineW = f.widthOfTextAtSize(wrappedLines[li], fontSize);
          const x = alignedX(align, block.bbox.x, block.bbox.w, lineW);
          const y =
            pageHeight - block.bbox.y - fontSize - li * lineStep;
          page.drawText(wrappedLines[li], {
            x,
            y,
            size: fontSize,
            font: f,
            color: rgb(r, g, b),
          });
        }
      };

      try {
        drawAllLines(font, safe);
      } catch (err) {
        console.warn(
          '[textBlockEdits] drawText 失败,用 ? 兜底重试 block %s:',
          block.id,
          err
        );
        await fallbackDrawText(
          doc,
          fontCache,
          page,
          pageHeight,
          block,
          fontSize,
          lineStep,
          align,
          rgb(r, g, b)
        );
      }
    }
  }
}

/** Fallback: draw with Helvetica and '?' for non-ASCII characters. */
async function fallbackDrawText(
  doc: PDFDocument,
  fontCache: Map<string, PDFFont>,
  page: PDFPage,
  pageHeight: number,
  block: TextBlockItem,
  fontSize: number,
  lineStep: number,
  align: 'left' | 'center' | 'right',
  color: ReturnType<typeof rgb>
): Promise<void> {
  try {
    const fallbackName = pickStandardFont('Helvetica', false, false);
    let fb = fontCache.get(fallbackName);
    if (!fb) {
      fb = await doc.embedFont(fallbackName);
      fontCache.set(fallbackName, fb);
    }
    let safeAscii = '';
    for (const ch of block.text) {
      safeAscii += (ch.codePointAt(0) ?? 0) > 0x7e ? '?' : ch;
    }
    const wrappedLines = wrapText(fb, safeAscii, block.bbox.w, fontSize);
    for (let li = 0; li < wrappedLines.length; li++) {
      const lineW = fb.widthOfTextAtSize(wrappedLines[li], fontSize);
      const x = alignedX(align, block.bbox.x, block.bbox.w, lineW);
      const y = pageHeight - block.bbox.y - fontSize - li * lineStep;
      page.drawText(wrappedLines[li], {
        x,
        y,
        size: fontSize,
        font: fb,
        color,
      });
    }
  } catch (err2) {
    console.error(
      '[textBlockEdits] 兜底 drawText 也失败,跳过 block %s:',
      block.id,
      err2
    );
  }
}
