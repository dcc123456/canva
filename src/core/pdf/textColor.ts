// core/pdf/textColor.ts
//
// 从 PDF 内容流抽取文字真实颜色。MuPDF 的 StructuredText 不暴露颜色,
// 所以用 pdfjs 的 getOperatorList() 遍历算子表:
//   - 追踪 setFillRGBColor / setFillGray / setFillCMYKColor 的填色状态
//   - 遇到 showText 时用当前填色 + 文本矩阵位置记录 (text, color, x, y)
//   - 然后按位置匹配到 MuPDF 检测的 text-block,赋真实颜色
//
// 坐标系:pdfjs 的文本矩阵 (e, f) 是 PDF 坐标(y-up, 原点在左下)。
// MuPDF block 的 bbox.y 是 y-down(原点在左上),与 textQuad.ts 的 quad 一致。
// 匹配时转换:block y-down -> y-up: yUp = pageHeight - yDown。
import type { PDFPageProxy } from 'pdfjs-dist';
import { pdfjsLib } from './loader';
import type { Rect } from '../types';

export interface ColoredText {
  text: string;
  color: string; // hex "#rrggbb"
  x: number; // PDF x (y-up, 左下原点)
  y: number; // PDF y baseline (y-up)
}

/**
 * 遍历 pdfjs operator list,记录每段文字的颜色和位置。
 */
export async function extractTextColors(
  page: PDFPageProxy
): Promise<ColoredText[]> {
  const ops = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;
  const results: ColoredText[] = [];

  let color = { r: 0, g: 0, b: 0 }; // 默认黑色
  let textX = 0;
  let textY = 0;

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];

    switch (fn) {
      case OPS.setFillRGBColor:
        color = { r: args[0], g: args[1], b: args[2] };
        break;
      case OPS.setFillGray: {
        const g = args[0];
        color = { r: g, g, b: g };
        break;
      }
      case OPS.setFillCMYKColor: {
        const [c, m, y, k] = args;
        // 简化 CMYK -> RGB 转换
        color = {
          r: (1 - c) * (1 - k),
          g: (1 - m) * (1 - k),
          b: (1 - y) * (1 - k),
        };
        break;
      }
      case OPS.setTextMatrix:
        // args = [a, b, c, d, e, f]; e=x, f=y (y-up)
        textX = args[4];
        textY = args[5];
        break;
      case OPS.moveText:
        // Td: 相对移动
        textX += args[0];
        textY += args[1];
        break;
      case OPS.showText:
      case OPS.showSpacedText: {
        const items = args[0] as Array<string | number>;
        let textStr = '';
        for (const item of items) {
          if (typeof item === 'string') {
            textStr += item;
          }
        }
        if (textStr.trim()) {
          results.push({
            text: textStr,
            color: rgbToHex(color.r, color.g, color.b),
            x: textX,
            y: textY,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return results;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 按位置将彩色文字条目匹配到 MuPDF block,返回 blockId -> color 映射。
 *
 * @param coloredTexts extractTextColors 的输出(y-up 坐标)
 * @param blocks MuPDF 检测的 block(bbox.y 是 y-down)
 * @param pageHeight 页面高度(用于 y-up <-> y-down 转换)
 */
export function matchColorsToBlocks(
  coloredTexts: ColoredText[],
  blocks: Array<{ id: string; bbox: Rect }>,
  pageHeight: number
): Map<string, string> {
  const result = new Map<string, string>();

  for (const block of blocks) {
    // block bbox 是 y-down(顶部 y=block.bbox.y,底部 y=block.bbox.y+block.bbox.h)
    // 转为 y-up:yUp_top = pageHeight - block.bbox.y, yUp_bottom = pageHeight - (y+h)
    const xMin = block.bbox.x;
    const xMax = block.bbox.x + block.bbox.w;
    const yUpTop = pageHeight - block.bbox.y;
    const yUpBottom = pageHeight - (block.bbox.y + block.bbox.h);

    const colorCounts = new Map<string, number>();
    for (const ct of coloredTexts) {
      if (
        ct.x >= xMin &&
        ct.x <= xMax &&
        ct.y >= yUpBottom &&
        ct.y <= yUpTop
      ) {
        colorCounts.set(ct.color, (colorCounts.get(ct.color) || 0) + 1);
      }
    }

    // 取出现次数最多的颜色
    let bestColor = '';
    let bestCount = 0;
    for (const [c, count] of colorCounts) {
      if (count > bestCount) {
        bestColor = c;
        bestCount = count;
      }
    }
    if (bestCount > 0) {
      result.set(block.id, bestColor);
    }
  }

  return result;
}
