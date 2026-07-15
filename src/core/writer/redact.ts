// core/writer/redact.ts
//
// MuPDF 字节级删字管线。替代旧的 pdf-lib 白底覆盖策略。
//
// 流程:
//   1. 用 MuPDF 打开干净的原 PDF 字节
//   2. 对每个含编辑块的页:遍历 StructuredText,收集 originalBbox 区域内
//      的字符原始 quad(8 元组),创建 Redact 注释,setQuadPoints,
//      applyRedactions(false, 0, 0, 0) -- 不画黑框、不动图片/矢量、只删文字
//   3. saveToBuffer -> 返回 redacted 字节
//
// 关键:walker 的 quad 与 setQuadPoints 同属 MuPDF 内部坐标系,直接透传,
// 无需任何坐标转换(旧白底路径要 pageHeight - q.y - q.h 是因为跨到 pdf-lib)。
//
// 失败兜底:若 MuPDF redaction 抛错,返回原始 cleanBytes + redacted:false,
// 调用方据此走旧白底路径。
import { loadMupdf, type MupdfNs } from '../mupdf/loader';
import type { Rect } from '../types';

export interface RedactEdit {
  /** 原始 PDF 中的页索引(0-based,不含 blank 页)。 */
  pageIndex: number;
  /** 检测时的原始位置(redaction 区域)。 */
  originalBbox: Rect;
}

export interface RedactResult {
  bytes: Uint8Array;
  /** true = 已成功 redact,调用方跳过白底;false = 失败,走白底兜底。 */
  redacted: boolean;
}

/**
 * 对 cleanBytes 应用所有编辑块的 redaction,返回 redacted 字节。
 * 若 MuPDF 不可用或 redaction 失败,返回原始字节 + redacted:false。
 */
export async function applyMupdfRedactions(
  cleanBytes: Uint8Array,
  edits: RedactEdit[]
): Promise<RedactResult> {
  if (edits.length === 0) {
    return { bytes: cleanBytes, redacted: true };
  }
  try {
    const mupdf = await loadMupdf();
    return applyRedactionsImpl(mupdf, new Uint8Array(cleanBytes), edits);
  } catch (err) {
    console.warn('[redact] MuPDF 不可用,跳过 redaction:', err);
    return { bytes: cleanBytes, redacted: false };
  }
}

type MupdfQuad = [number, number, number, number, number, number, number, number];

function applyRedactionsImpl(
  mupdf: MupdfNs,
  bytes: Uint8Array,
  edits: RedactEdit[]
): RedactResult {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const pdfDoc = doc.asPDF();
    if (!pdfDoc) {
      console.warn('[redact] doc.asPDF() 返回 null,跳过');
      return { bytes, redacted: false };
    }

    // 按页分组编辑块。
    const byPage = new Map<number, Rect[]>();
    for (const edit of edits) {
      let list = byPage.get(edit.pageIndex);
      if (!list) {
        list = [];
        byPage.set(edit.pageIndex, list);
      }
      list.push(edit.originalBbox);
    }

    let totalQuadsApplied = 0;

    for (const [pageIndex, bboxes] of byPage) {
      const page = pdfDoc.loadPage(pageIndex) as import('mupdf').PDFPage;
      try {
        const pageQuads = collectQuadsForBboxes(mupdf, page, bboxes);
        if (pageQuads.length === 0) continue;

        // 创建一个 Redact 注释,塞入本页所有 quad。
        const annot = page.createAnnotation('Redact');
        annot.setQuadPoints(pageQuads as import('mupdf').Quad[]);
        // 不画黑框、不动图片/矢量、只删文字。
        page.applyRedactions(false, 0, 0, 0);
        totalQuadsApplied += pageQuads.length;
        try {
          annot.destroy();
        } catch {
          /* ignore */
        }
      } finally {
        page.destroy();
      }
    }

    if (totalQuadsApplied === 0) {
      // 没收集到任何 quad -- 不需要 save,返回原始字节。
      return { bytes, redacted: false };
    }

    const buffer = pdfDoc.saveToBuffer();
    return { bytes: buffer.asUint8Array(), redacted: true };
  } catch (err) {
    console.warn('[redact] redaction 执行失败,返回原始字节:', err);
    return { bytes, redacted: false };
  } finally {
    doc.destroy();
  }
}

/**
 * 遍历 StructuredText,收集落在任一 bbox 区域内的字符原始 quad。
 * quad 透传不做坐标转换 -- MuPDF walker 与 setQuadPoints 同坐标系。
 */
function collectQuadsForBboxes(
  _mupdf: MupdfNs,
  page: import('mupdf').PDFPage,
  bboxes: Rect[]
): MupdfQuad[] {
  const hits: MupdfQuad[] = [];
  const stext = page.toStructuredText('preserve-spans');
  try {
    // 预计算每个 bbox 的扩展边界(与 textQuad.ts 一致的 padding)。
    const expanded = bboxes.map((b) => {
      const expandX = 0.05;
      const expandY = 0.25;
      return {
        xMin: b.x - b.w * expandX,
        xMax: b.x + b.w + b.w * expandX,
        yMin: b.y - b.h * expandY,
        yMax: b.y + b.h + b.h * expandY,
      };
    });

    const walker: Record<string, unknown> = {
      beginLine() { /* no-op */ },
      endLine() { /* no-op */ },
      beginTextBlock() { /* no-op */ },
      endTextBlock() { /* no-op */ },
      beginStruct() { /* no-op */ },
      endStruct() { /* no-op */ },
      onChar(
        _utf: string,
        _origin: number[],
        _font: unknown,
        _size: number,
        quad: number[]
      ) {
        if (quad.length < 8) return;
        // 计算 AABB 用于相交判定。
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
        for (const e of expanded) {
          if (
            minX + cw >= e.xMin &&
            minX <= e.xMax &&
            minY + ch >= e.yMin &&
            minY <= e.yMax
          ) {
            hits.push([
              quad[0], quad[1],
              quad[2], quad[3],
              quad[4], quad[5],
              quad[6], quad[7],
            ]);
            return;
          }
        }
      },
      onImageBlock() { /* no-op */ },
      onVector() { /* no-op */ },
    };
    (stext as unknown as { walk: (w: unknown) => void }).walk(walker);
  } finally {
    stext.destroy();
  }

  // 兜底:walker 一个字都没拿到时,用 bbox 自身作为 quad(4 角点),
  // 确保至少有覆盖。这与 textQuad.ts 的 bbox 兜底语义一致。
  if (hits.length === 0) {
    for (const b of bboxes) {
      hits.push([b.x, b.y, b.x + b.w, b.y, b.x, b.y + b.h, b.x + b.w, b.y + b.h]);
    }
  }
  return hits;
}
