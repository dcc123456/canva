// core/writer/textQuad.ts
//
// 用 MuPDF 的 StructuredText walker 收集某个 bbox 区域内的字符级
// quad。导出时对"被编辑过的 text-block"用这些 quad 做精确白底覆盖,
// 比按整个 bbox 画白底更准确(不会盖到相邻文字)。
//
// mupdf 在文档没装好嵌入字体时常以 identity encoding 渲染字符,
// 但 stext + walker 给出的字符 quad 仍然是按 PDF 内容流实际码位
// 算出的几何边界(坐标跟 unicode 字符是对得上的)。所以我们不依赖
// mupdf `applyRedactions` 的文本匹配,直接收集字符级 quad 列表给
// pdf-lib 去覆盖。
import { loadMupdf, type MupdfNs } from '../mupdf/loader';

export interface Quad {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function collectWhiteoutRectsWithMupdf(
  mupdf: MupdfNs,
  bytes: Uint8Array,
  pageIndex: number,
  bbox: { x: number; y: number; w: number; h: number }
): Quad[] {
  const buf = new Uint8Array(bytes);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  let out: Quad[] = [];
  try {
    const pdfDoc = doc.asPDF();
    if (!pdfDoc) return out;
    const page = pdfDoc.loadPage(pageIndex) as import('mupdf').PDFPage;
    try {
      const expandX = 0.05;
      const expandY = 0.25;
      const xMin = bbox.x - bbox.w * expandX;
      const xMax = bbox.x + bbox.w + bbox.w * expandX;
      const yMin = bbox.y - bbox.h * expandY;
      const yMax = bbox.y + bbox.h + bbox.h * expandY;

      const stext = page.toStructuredText('preserve-spans');
      const charHits: Quad[] = [];
      const walker: Record<string, unknown> = {
        beginLine: function () {
          /* no-op */
        },
        endLine: function () {
          /* no-op */
        },
        beginTextBlock: function () {
          /* no-op */
        },
        endTextBlock: function () {
          /* no-op */
        },
        beginStruct: function () {
          /* no-op */
        },
        endStruct: function () {
          /* no-op */
        },
        onChar: function (
          _utf: string,
          _origin: number[],
          _font: unknown,
          _size: number,
          quad: number[]
        ) {
          if (quad.length < 8) return;
          let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
          for (let i = 0; i < 8; i += 2) {
            const xv = quad[i];
            const yv = quad[i + 1];
            if (xv < minX) minX = xv;
            if (xv > maxX) maxX = xv;
            if (yv < minY) minY = yv;
            if (yv > maxY) maxY = yv;
          }
          const cw = maxX - minX;
          const ch = maxY - minY;
          if (
            minX + cw >= xMin &&
            minX <= xMax &&
            minY + ch >= yMin &&
            minY <= yMax
          ) {
            charHits.push({ x: minX, y: minY, w: cw, h: ch });
          }
        },
        onImageBlock: function () {
          /* no-op */
        },
        onVector: function () {
          /* no-op */
        },
      };
      (stext as unknown as { walk: (w: unknown) => void }).walk(walker);
      stext.destroy();
      out = charHits;
    } finally {
      page.destroy();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[textQuad] 字符 quad 收集失败:', err);
  } finally {
    doc.destroy();
  }
  if (out.length === 0) {
    // walker 完全没拿到字符 -- 用整个 block.bbox 兜底,避免没擦到。
    out = [{ x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }];
  }
  return out;
}

/**
 * 异步版本:自动加载 mupdf 后收集字符 quad。
 * 如果 mupdf 加载失败,返回整个 bbox 作为兜底。
 */
export async function collectWhiteoutQuads(
  bytes: Uint8Array,
  pageIndex: number,
  bbox: { x: number; y: number; w: number; h: number }
): Promise<Quad[]> {
  try {
    const mupdf = await loadMupdf();
    return collectWhiteoutRectsWithMupdf(mupdf, bytes, pageIndex, bbox);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[textQuad] mupdf 不可用,使用 bbox 兜底白底:',
      err
    );
    return [{ x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }];
  }
}
