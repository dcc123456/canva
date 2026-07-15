// features/text-edit/reflow.ts
//
// 块间下推回流。当一个 text-block 的高度变化时(手动 resize 或自动增高),
// 将同页中位于其下方、x 范重叠的后续块沿 y 方向平移 deltaH。
//
// 设计:
//   - 只推 overlay 块(原 PDF 文字不动,由 redaction 在导出时处理)
//   - 不跨页(页面底部溢出不自动新增页)
//   - originalBbox 不变(只改 bbox),保证 redaction 在原位置删字
//   - 通过 shiftBlocks 单次历史记录,可整体撤销
import { useDocumentStore } from '../../store/documentStore';
import type { Rect } from '../../core/types';

function xOverlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x;
}

/**
 * 将 changedBlockId 下方(同页、x 重叠)的 text-block 沿 y 方向平移 deltaH。
 * deltaH > 0 = 增高后下推;deltaH < 0 = 缩矮后上拉。
 */
export function pushDownSubsequentBlocks(
  pageId: string,
  changedBlockId: string,
  deltaH: number
): void {
  if (Math.abs(deltaH) < 0.5) return;

  const { overlays, shiftBlocks } = useDocumentStore.getState();

  const changedBlock = overlays.find(
    (o) => o.id === changedBlockId && o.type === 'text-block'
  );
  if (!changedBlock || changedBlock.type !== 'text-block') return;

  // OLD bottom = current bottom - deltaH
  const oldBottomY =
    changedBlock.bbox.y + changedBlock.bbox.h - deltaH;

  const shifts: Array<{ id: string; dy: number }> = [];
  for (const o of overlays) {
    if (
      o.type !== 'text-block' ||
      o.pageId !== pageId ||
      o.id === changedBlockId
    ) {
      continue;
    }
    // 块在 oldBottom 之下(或刚好接触)且 x 范重叠 -> 需要平移
    if (o.bbox.y >= oldBottomY && xOverlaps(o.bbox, changedBlock.bbox)) {
      shifts.push({ id: o.id, dy: deltaH });
    }
  }

  if (shifts.length > 0) {
    shiftBlocks(shifts);
  }
}
