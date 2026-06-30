// mupdf/loader.ts
//
// 浏览器端 MuPDF.js 加载器。
//
// 与之前那版"占位实现"完全不同 —— 现在用的是 Artifex 官方的 `mupdf` npm
// 包（v1.27+），它把 MuPDF 的 C 引擎以 WebAssembly 形式发布，原生支持
// Node 18+ 和现代浏览器。包入口是顶层 await 的 ESM 模块，import 之后
// 立刻就能拿到完整的类型化 API（`Document`、`PDFDocument`、`PDFPage`、
// `Buffer` 等）。
//
// 我们暴露:
//   * `loadMupdf(onProgress?)`  ——  幂等加载，返回完整的 mupdf 命名空间。
//   * `MupdfNs` 类型             ——  方便其它模块写注解。
import { useEngineStore } from '../../store/engineStore';

export type LoadProgress = (progress: number, label?: string) => void;

export type MupdfNs = typeof import('mupdf');

let pending: Promise<MupdfNs> | null = null;
let resolved: MupdfNs | null = null;

export async function loadMupdf(onProgress?: LoadProgress): Promise<MupdfNs> {
  if (resolved) {
    onProgress?.(1, '复用已加载结果');
    return resolved;
  }
  if (pending) {
    onProgress?.(0.5, '等待 mupdf 初始化');
    return pending;
  }
  pending = (async () => {
    onProgress?.(0.05, '加载 mupdf 模块');
    try {
      // 顶层 await ESM:`import * as mupdf` 在这里就完成了 wasm 实例化。
      const mupdf = (await import('mupdf')) as MupdfNs;
      onProgress?.(0.85, '实例化 wasm');
      resolved = mupdf;
      onProgress?.(1, 'mupdf ready');
      return mupdf;
    } catch (err) {
      pending = null;
      useEngineStore
        .getState()
        .setMupdfError(`MuPDF.js 加载失败: ${String(err)}`);
      throw err;
    }
  })();
  return pending;
}

export function getMupdfIfLoaded(): MupdfNs | null {
  return resolved;
}

export function resetMupdfCache(): void {
  resolved = null;
  pending = null;
}
