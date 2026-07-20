// core/writer/cjkFont.ts
//
// CJK 字体加载,供导出管线(flatten / textBlockEdits)共用。
//
// pdf-lib 的 14 个 Standard Fonts 仅 WinAnsi(ASCII / 西欧),不覆盖
// 中日韩。中文场景下用 @pdf-lib/fontkit 嵌入 OTF/TTF。
//
// ADR 0001:FontClass 系统
//   - 'cjk-sans'  -> SourceHanSansCN-Regular.otf / SourceHanSansCN-Bold.otf
//   - 'cjk-serif' -> SourceHanSerifCN-Regular.otf / SourceHanSerifCN-Bold.otf
//
// Bold 变体通过 (fontClass, weight) 组合加载,用真 Bold 字重文件,
// 不再靠偏移模拟粗体。
//
// 字体文件随项目分发在 public/fonts/,首次拉取后缓存。
// 本地字体路径用 import.meta.env.BASE_URL 确保 dev/prod 都能正确解析。
// Vite dev: BASE_URL="/" -> "/fonts/..."。Prod: BASE_URL="./" -> "./fonts/..."。
import type { FontClass } from '../types';

/** 字重标识:Regular 或 Bold。 */
export type FontWeight = 'regular' | 'bold';

interface FontVariant {
  fontClass: FontClass;
  weight: FontWeight;
}

const LOCAL_FONT_FILES: Record<FontClass, Record<FontWeight, string>> = {
  'cjk-sans': {
    regular: 'SourceHanSansCN-Regular.otf',
    bold: 'SourceHanSansCN-Bold.otf',
  },
  'cjk-serif': {
    regular: 'SourceHanSerifCN-Regular.otf',
    bold: 'SourceHanSerifCN-Bold.otf',
  },
  // sans/serif/mono 走 pdf-lib StandardFonts,没有本地文件
  sans: { regular: '', bold: '' },
  serif: { regular: '', bold: '' },
  mono: { regular: '', bold: '' },
};

function localUrl(fontClass: FontClass, weight: FontWeight): string {
  const file = LOCAL_FONT_FILES[fontClass]?.[weight];
  if (!file) return '';
  return `${import.meta.env.BASE_URL}fonts/${file}`;
}

function cdnUrls(fontClass: FontClass, weight: FontWeight): string[] {
  const baseRepo =
    fontClass === 'cjk-sans'
      ? 'adobe-fonts/source-han-sans@release/SubsetOTF/CN'
      : 'adobe-fonts/source-han-serif@release/SubsetOTF/CN';
  const fileBase =
    fontClass === 'cjk-sans' ? 'SourceHanSansCN' : 'SourceHanSerifCN';
  const file = `${fileBase}-${weight === 'bold' ? 'Bold' : 'Regular'}.otf`;
  return [
    `/fonts/${file}`,
    `https://cdn.jsdelivr.net/gh/${baseRepo}/${file}`,
    `https://fastly.jsdelivr.net/gh/${baseRepo}/${file}`,
  ];
}

// Per-(fontClass, weight) cache
const cacheKey = (v: FontVariant) => `${v.fontClass}:${v.weight}`;
const bytesCache: Partial<Record<string, Uint8Array>> = {};
const pendingCache: Partial<Record<string, Promise<Uint8Array | null>>> = {};

/** 允许外部(测试或运行时)塞入字体字节以跳过 CDN 拉取。 */
export function setCjkFontBytes(
  bytes: Uint8Array,
  fontClass: FontClass = 'cjk-sans',
  weight: FontWeight = 'regular'
): void {
  bytesCache[cacheKey({ fontClass, weight })] = bytes;
}

/** 旧 API 保留:等价于 setCjkFontBytes(bytes, 'cjk-sans', 'regular')。 */
export function setCjkSansFontBytes(bytes: Uint8Array): void {
  setCjkFontBytes(bytes, 'cjk-sans', 'regular');
}

/** 按指定 fontClass + weight 加载对应 CJK 字体字节。失败返回 null。 */
export async function loadCjkFontBytesForVariant(
  fontClass: FontClass,
  weight: FontWeight = 'regular'
): Promise<Uint8Array | null> {
  if (fontClass !== 'cjk-sans' && fontClass !== 'cjk-serif') return null;
  const key = cacheKey({ fontClass, weight });
  const cached = bytesCache[key];
  if (cached) return cached;
  const pending = pendingCache[key];
  if (pending) return pending;
  const local = localUrl(fontClass, weight);
  const urls = [local, ...cdnUrls(fontClass, weight)].filter(Boolean);
  const promise = (async () => {
    for (const url of urls) {
      try {
        console.log('[cjkFont] 尝试加载 %s %s: %s', fontClass, weight, url);
        const resp = await fetch(url);
        if (!resp.ok) {
          console.warn('[cjkFont] %s 返回 %d', url, resp.status);
          continue;
        }
        const ab = await resp.arrayBuffer();
        // Vite dev server 对 404 可能返回 HTML(SPA fallback,状态 200)。
        // 字体文件至少 >1MB,小于 100KB 的肯定不是字体。
        if (ab.byteLength < 100_000) {
          console.warn(
            '[cjkFont] %s 响应太小(%d B),可能不是字体',
            url,
            ab.byteLength
          );
          continue;
        }
        const bytes = new Uint8Array(ab);
        bytesCache[key] = bytes;
        console.log(
          '[cjkFont] %s %s 加载成功: %s (%d KB)',
          fontClass,
          weight,
          url,
          Math.round(ab.byteLength / 1024)
        );
        return bytes;
      } catch (err) {
        console.warn('[cjkFont] %s 失败:', url, err);
      }
    }
    console.error('[cjkFont] %s %s 所有字体源都失败', fontClass, weight);
    return null;
  })().finally(() => {
    delete pendingCache[key];
  });
  pendingCache[key] = promise;
  return promise;
}

/** 按 fontClass 加载 Regular 字体(向后兼容旧 API)。 */
export async function loadCjkFontBytesForClass(
  fontClass: FontClass
): Promise<Uint8Array | null> {
  return loadCjkFontBytesForVariant(fontClass, 'regular');
}

/** 旧 API 保留:等价于 loadCjkFontBytesForVariant('cjk-sans', 'regular')。 */
export async function loadCjkFontBytes(): Promise<Uint8Array | null> {
  return loadCjkFontBytesForVariant('cjk-sans', 'regular');
}

export function containsNonAscii(s: string): boolean {
  for (const ch of s) {
    if ((ch.codePointAt(0) ?? 0) > 0x7e) return true;
  }
  return false;
}
