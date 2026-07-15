// core/writer/fontExtract.ts
//
// 从原 PDF 抽取嵌入的字体程序字节(用于重画新字时匹配原文字体)。
//
// pdf-lib 的低层 API:遍历页面的 Font 资源字典 -> FontDescriptor ->
// FontFile2(TrueType)/FontFile3(CFF/OpenType)流 -> getContents() 取解压字节。
// 抽取出的字节用 doc.embedFont(bytes, { subset: true }) 嵌入。
//
// 跳过的情况:
//   - MuPDF 泛化字体名("embedded"、"g_d0_f1" 等)无法匹配
//   - FontFile(Type1)字体:fontkit 不支持解析,返回 null 走 StandardFonts
//   - 字体未嵌入(只有引用无流):返回 null
import { PDFName, PDFDict, PDFStream, PDFRef } from 'pdf-lib';
import type { PDFDocument } from 'pdf-lib';

/**
 * 从指定页的字体资源中抽取与 fontName 匹配的嵌入字体字节。
 *
 * @param doc 已加载的 PDFDocument(applyPages 后的)
 * @param pageIndex 编辑器页索引(与 block.pageId 对应)
 * @param fontName MuPDF 检测到的字体名(可能含子集前缀如 "ABCDEF+SimSun")
 * @returns 字体程序字节,或 null(未嵌入/Type1/无法匹配)
 */
export function extractEmbeddedFont(
  doc: PDFDocument,
  pageIndex: number,
  fontName: string
): Uint8Array | null {
  const lower = fontName.toLowerCase();
  // MuPDF 泛化字体名无法匹配,跳过。
  if (lower === 'embedded' || /^g_d\d+_f\d+$/.test(lower)) {
    return null;
  }

  // 归一化:去子集前缀 "ABCDEF+" -> ""
  const target = fontName.replace(/^[A-Z]{6}\+/, '').toLowerCase();
  if (!target) return null;

  let page: ReturnType<typeof doc.getPage>;
  try {
    page = doc.getPage(pageIndex);
  } catch {
    return null;
  }

  const resources = page.node.Resources();
  if (!resources) return null;

  const fontDict = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fontDict) return null;

  for (const [, value] of fontDict.entries()) {
    // 解引用:可能是 PDFRef(间接引用)或 PDFDict(直接对象)
    let fontObj: PDFDict | undefined;
    if (value instanceof PDFRef) {
      const resolved = doc.context.lookup(value);
      fontObj = resolved instanceof PDFDict ? resolved : undefined;
    } else if (value instanceof PDFDict) {
      fontObj = value;
    }
    if (!fontObj) continue;

    // 匹配 BaseFont 名
    const baseFont = fontObj.lookupMaybe(PDFName.of('BaseFont'), PDFName);
    if (!baseFont) continue;

    const baseFontStr = baseFont
      .decodeText()
      .replace(/^[A-Z]{6}\+/, '')
      .toLowerCase();

    // 双向包含匹配(处理子集前缀差异和名称变体)
    if (
      !baseFontStr.includes(target) &&
      !target.includes(baseFontStr)
    ) {
      continue;
    }

    // 找到匹配字体,取 FontDescriptor
    const fontDesc = fontObj.lookupMaybe(
      PDFName.of('FontDescriptor'),
      PDFDict
    );
    if (!fontDesc) continue;

    // 优先 FontFile2(TrueType),其次 FontFile3(CFF/OpenType)。
    // 跳过 FontFile(Type1) -- fontkit 不支持解析 Type1 字体。
    for (const key of ['FontFile2', 'FontFile3']) {
      const stream = fontDesc.lookupMaybe(PDFName.of(key), PDFStream);
      if (stream) {
        try {
          return stream.getContents();
        } catch {
          // 流损坏,尝试下一个
          continue;
        }
      }
    }
  }

  return null;
}
