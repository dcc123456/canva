// features/text-edit/useCommitTextBlock.ts
//
// 共享的"把 text-block 的新文字写回"逻辑,被 TextBlockEditLayer(画布
// 上的浮层编辑器)和 Inspector(右侧属性面板的文字内容输入框)同时
// 调用。
//
// 重构后:编辑只更新 overlay,绝不碰 store.pdfBytes。原 PDF 字节始终
// 保持干净,导出时再统一应用所有编辑(见 core/writer/textBlockEdits.ts)。
// 这样:
//   * 编辑即时(同步,无 WASM 引擎调用、无 pdfjs 重载)
//   * 画布与导出一致(都基于"原字 + 白底 + 新字"模型)
//   * 撤销/重做只记录 overlay patch
import { useCallback } from 'react';
import { useDocumentStore } from '../../store/documentStore';
import type { TextBlockItem, RichTextSegment } from '../../core/types';

export interface CommitOptions {
  block: TextBlockItem;
  pageIndex: number;
  newText: string;
  /** Optional rich-text segments from the contenteditable editor. */
  segments?: RichTextSegment[];
}

export interface UseCommitTextBlockReturn {
  /** 同步提交:只更新 overlay,返回是否成功(永远为 true 除非文本未变)。 */
  commit: (options: CommitOptions) => boolean;
}

export function useCommitTextBlock(): UseCommitTextBlockReturn {
  const updateOverlay = useDocumentStore((s) => s.updateOverlay);

  const commit = useCallback(
    ({ block, newText, segments }: CommitOptions): boolean => {
      if (newText === block.text && segments === undefined) {
        return true;
      }
      const patch: Partial<TextBlockItem> = { text: newText };
      if (segments !== undefined) {
        // Only store segments if they contain actual formatting.
        const hasFormatting = segments.some(
          (s) => s.bold || s.italic || s.color || s.fontSize || s.fontFamily || s.underline || s.strike
        );
        patch.segments = hasFormatting ? segments : undefined;
      }
      updateOverlay(block.id, patch as Partial<TextBlockItem>);
      return true;
    },
    [updateOverlay]
  );

  return { commit };
}
