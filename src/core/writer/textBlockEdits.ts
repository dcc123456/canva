// core/writer/textBlockEdits.ts
//
// 导出时把"被编辑过的 text-block"(text !== originalText)统一应用到
// PDFDocument。重构后支持两种路径:
//   - redacted=true (优先): MuPDF 已字节级删字 (redact.ts),本函数只画新字
//   - redacted=false (兜底): MuPDF redaction 失败时,走旧白底覆盖 + 重画
//
// 旧路径(白底):
//   1. 用 MuPDF 从干净原 pdfBytes 收集原字字符级 quad
//   2. 用 pdf-lib 按字符 quad 画白底(精确覆盖原字)
//   3. 用 pdf-lib 在原 baseline 画新字(CJK 用 fontkit + Source Han Sans)
//
// 新路径(redaction):步骤 1-2 由 redact.ts 在导出前完成,本函数只做步骤 3。
import { PDFDocument, PDFPage, rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PageMeta, TextBlockItem } from '../types';
import { hexToRgb, pickStandardFont, wrapText, alignedX } from './helpers';
import { loadCjkFontBytes, containsNonAscii } from './cjkFont';
import { collectWhiteoutQuads, type Quad } from './textQuad';
import { extractEmbeddedFont } from './fontExtract';

export interface ApplyTextBlockRedrawsOptions {
  /** 已通过 applyPages 处理好页面顺序/旋转的 PDFDocument。 */
  doc: PDFDocument;
  /** 原 PDF 字节。redacted=true 时为已删字字节;redacted=false 时为干净原字节(用于白底 quad)。 */
  originalBytes: Uint8Array;
  pages: PageMeta[];
  /** 仅 text !== originalText 的 text-block。 */
  textBlocks: TextBlockItem[];
  /** true = MuPDF 已 redact(跳过白底);false = 走白底兜底。 */
  redacted: boolean;
}

/**
 * 对每个被编辑的 text-block:
 *   - redacted=true: 直接画新字(MuPDF 已删原字)
 *   - redacted=false: 收集字符 quad -> 画白底 -> 画新字
 */
export async function applyTextBlockRedraws(
  options: ApplyTextBlockRedrawsOptions
): Promise<void> {
  const { doc, originalBytes, pages, textBlocks, redacted } = options;
  if (textBlocks.length === 0) return;

  // 字体缓存:同一字体只 embed 一次。
  const fontCache = new Map<string, PDFFont>();
  // 抽取字体缓存:key = "pageIndex:fontName", value = PDFFont | null
  const extractedFontCache = new Map<string, PDFFont | null>();
  let cjkFont: PDFFont | null = null;
  let cjkFontAttempted = false;

  async function getFont(
    text: string,
    bold: boolean,
    italic: boolean,
    fontName = 'Helvetica',
    editorPageIndex = -1
  ): Promise<{ font: PDFFont; safe: string }> {
    // 1. 优先从原 PDF 抽取嵌入字体(匹配原文字体,不退化为 StandardFonts)。
    if (editorPageIndex >= 0) {
      const cacheKey = `${editorPageIndex}:${fontName}`;
      if (!extractedFontCache.has(cacheKey)) {
        const bytes = extractEmbeddedFont(doc, editorPageIndex, fontName);
        if (bytes) {
          try {
            const font = await doc.embedFont(bytes, { subset: true });
            extractedFontCache.set(cacheKey, font);
          } catch {
            extractedFontCache.set(cacheKey, null);
          }
        } else {
          extractedFontCache.set(cacheKey, null);
        }
      }
      const extracted = extractedFontCache.get(cacheKey);
      if (extracted) {
        return { font: extracted, safe: text };
      }
    }

    // 2. 降级路径:CJK CDN 字体 / StandardFonts
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

    // 白底覆盖:仅在未 redact 时执行(redact 路径已字节级删字,无需覆盖)。
    if (!redacted) {
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
    }

    // (3) 画新字。
    if (!block.text) continue;

    if (block.segments && block.segments.length > 0) {
      // Draw segments sequentially with per-line alignment.
      // Each segment can have its own bold/italic/underline/strike/color/fontSize/fontFamily.
      type SegInfo = {
        text: string;
        font: PDFFont;
        width: number;
        color: string;
        size: number;
        underline: boolean;
        strike: boolean;
      };
      const lines: SegInfo[][] = [[]];

      for (const seg of block.segments) {
        const segBold = !!seg.bold;
        const segItalic = !!seg.italic;
        const segColor = seg.color || block.color;
        const segSize = seg.fontSize || block.fontSize;
        const segFontName = seg.fontFamily || block.font;
        const parts = seg.text.split('\n');
        for (let pi = 0; pi < parts.length; pi++) {
          if (pi > 0) lines.push([]);
          const partText = parts[pi].replace(/\t/g, '    ');
          if (partText) {
            try {
              const { font, safe } = await getFont(
                partText,
                segBold,
                segItalic,
                segFontName,
                editorPageIndex
              );
              const width = font.widthOfTextAtSize(safe, segSize);
              lines[lines.length - 1].push({
                text: safe,
                font,
                width,
                color: segColor,
                size: segSize,
                underline: !!seg.underline,
                strike: !!seg.strike,
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
              size: s.size,
              font: s.font,
              color: rgb(sr, sg, sb),
            });
            // Draw underline / strikethrough as thin lines.
            if (s.underline || s.strike) {
              const underY = y - 1;
              const strikeY = y + s.size * 0.3;
              const lineColor = rgb(sr, sg, sb);
              if (s.underline) {
                page.drawLine({
                  start: { x, y: underY },
                  end: { x: x + s.width, y: underY },
                  thickness: Math.max(0.5, s.size / 18),
                  color: lineColor,
                });
              }
              if (s.strike) {
                page.drawLine({
                  start: { x, y: strikeY },
                  end: { x: x + s.width, y: strikeY },
                  thickness: Math.max(0.5, s.size / 18),
                  color: lineColor,
                });
              }
            }
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
        block.text.replace(/\t/g, '    '),
        block.bold,
        block.italic,
        block.font,
        editorPageIndex
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
    for (const ch of block.text.replace(/\t/g, '    ')) {
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
