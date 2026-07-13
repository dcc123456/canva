// core/writer/cjkFont.ts
//
// CJK 字体加载,供导出管线(flatten / textBlockEdits)共用。
//
// pdf-lib 的 14 个 Standard Fonts 仅 WinAnsi(ASCII / 西欧),不覆盖
// 中日韩。中文场景下用 @pdf-lib/fontkit 嵌入 OTF/TTF。
//
// 字体首次拉取后缓存在模块级变量,后续导出不再下载。CDN 源:
//   * 本地打包的 Adobe Source Han Sans CN(OFL,完整 GB18030
//     简体 + 常见繁体)。文件在 public/fonts/ 目录,随项目分发。
//   * CDN 源作为 fallback(本地文件缺失时)。
// 本地字体路径:用 import.meta.env.BASE_URL 确保 dev/prod 都能正确解析。
// Vite dev: BASE_URL="/" -> "/fonts/..."。Prod: BASE_URL="./" -> "./fonts/..."。
const LOCAL_FONT_URL = `${import.meta.env.BASE_URL}fonts/SourceHanSansCN-Regular.otf`;

const CJK_FONT_URLS = [
  LOCAL_FONT_URL,
  '/fonts/SourceHanSansCN-Regular.otf',
  'https://cdn.jsdelivr.net/gh/adobe-fonts/source-han-sans@release/SubsetOTF/CN/SourceHanSansCN-Regular.otf',
  'https://fastly.jsdelivr.net/gh/adobe-fonts/source-han-sans@release/SubsetOTF/CN/SourceHanSansCN-Regular.otf',
];
let cjkFontBytes: Uint8Array | null = null;
let cjkFontPending: Promise<Uint8Array | null> | null = null;

/** 允许外部(测试或运行时)塞入 CJK 字体字节以跳过 CDN 拉取。 */
export function setCjkFontBytes(bytes: Uint8Array): void {
  cjkFontBytes = bytes;
}

export async function loadCjkFontBytes(): Promise<Uint8Array | null> {
  if (cjkFontBytes) return cjkFontBytes;
  if (cjkFontPending) return cjkFontPending;
  cjkFontPending = (async () => {
    for (const url of CJK_FONT_URLS) {
      try {
        // eslint-disable-next-line no-console
        console.log('[cjkFont] 尝试加载: %s', url);
        const resp = await fetch(url);
        if (!resp.ok) {
          // eslint-disable-next-line no-console
          console.warn('[cjkFont] %s 返回 %d', url, resp.status);
          continue;
        }
        const ab = await resp.arrayBuffer();
        // Vite dev server 对 404 可能返回 HTML(SPA fallback,状态 200)。
        // 字体文件至少 >1MB,小于 100KB 的肯定不是字体。
        if (ab.byteLength < 100_000) {
          // eslint-disable-next-line no-console
          console.warn('[cjkFont] %s 响应太小(%d B),可能不是字体', url, ab.byteLength);
          continue;
        }
        cjkFontBytes = new Uint8Array(ab);
        // eslint-disable-next-line no-console
        console.log(
          '[cjkFont] CJK 字体加载成功: %s (%d KB)',
          url,
          Math.round(ab.byteLength / 1024)
        );
        return cjkFontBytes;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[cjkFont] %s 失败:', url, err);
      }
    }
    // eslint-disable-next-line no-console
    console.error('[cjkFont] 所有字体源都失败,中文将降级为 ?');
    return null;
  })().finally(() => {
    cjkFontPending = null;
  });
  return cjkFontPending;
}

export function containsNonAscii(s: string): boolean {
  for (const ch of s) {
    if ((ch.codePointAt(0) ?? 0) > 0x7e) return true;
  }
  return false;
}
