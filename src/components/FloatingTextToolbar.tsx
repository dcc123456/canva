// FloatingTextToolbar: appears near the text selection inside a
// contenteditable editor. Provides B / I / color buttons that use
// document.execCommand for inline rich-text formatting.
//
// The toolbar is position:fixed so it floats above everything. It
// tracks `selectionchange` and only shows when the selection is
// non-collapsed and contained within the editor element.
import { useEffect, useState } from 'react';

export interface FloatingTextToolbarProps {
  editorRef: React.RefObject<HTMLElement | null>;
}

export function FloatingTextToolbar({ editorRef }: FloatingTextToolbarProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    function update() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setPos(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const editor = editorRef.current;
      if (!editor || !editor.contains(range.commonAncestorContainer)) {
        setPos(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPos(null);
        return;
      }
      // Position above the selection, centered.
      setPos({
        top: rect.top - 36,
        left: rect.left + rect.width / 2,
      });
    }
    document.addEventListener('selectionchange', update);
    // Also update on mouseup/keyup (selectionchange can lag).
    document.addEventListener('mouseup', update);
    document.addEventListener('keyup', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('mouseup', update);
      document.removeEventListener('keyup', update);
    };
  }, [editorRef]);

  if (!pos) return null;

  return (
    <div
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-gray-300 bg-white px-1 py-0.5 shadow-lg dark:border-gray-600 dark:bg-gray-800"
      style={{
        top: Math.max(4, pos.top),
        left: pos.left,
        transform: 'translateX(-50%)',
      }}
      // Prevent mousedown from blurring the editor / losing selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        title="粗体"
        onClick={() => document.execCommand('bold')}
        className="flex h-6 w-6 items-center justify-center rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        <b>B</b>
      </button>
      <button
        type="button"
        title="斜体"
        onClick={() => document.execCommand('italic')}
        className="flex h-6 w-6 items-center justify-center rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        <i>I</i>
      </button>
      <label
        title="文字颜色"
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        <span>A</span>
        <input
          type="color"
          className="sr-only"
          onChange={(e) => {
            document.execCommand('foreColor', false, e.target.value);
          }}
        />
      </label>
    </div>
  );
}
