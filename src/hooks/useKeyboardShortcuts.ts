// Global keyboard shortcuts for the editor.
// - V / H / N / T / I / D / E / F -> switch tools (image / signature only
//   surface the picker; the rest update the tool directly).
// - Delete / Backspace -> remove the currently selected overlay.
// - Esc -> clear selection.
// - Ctrl/Cmd+Z -> undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) -> redo.
import { useEffect } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useDocumentStore } from '../store/documentStore';
import { useHistoryStore } from '../store/historyStore';
import type { Tool } from '../core/types';

const KEY_TO_TOOL: Record<string, Tool> = {
  v: 'select',
  e: 'edit-text',
  f: 'form',
  h: 'highlight',
  n: 'note',
  t: 'text',
  i: 'image',
  d: 'draw',
  s: 'signature',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(): void {
  const setTool = useEditorStore((s) => s.setTool);
  const setSelectedOverlayId = useEditorStore((s) => s.setSelectedOverlayId);
  const selectedOverlayId = useEditorStore((s) => s.selectedOverlayId);
  const removeOverlay = useDocumentStore((s) => s.removeOverlay);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Undo / redo — handled first so the mod-key branch doesn't fall
      // through to the tool switcher.
      if (mod && !e.altKey && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if (mod && !e.altKey && key === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      // Tool keys (no modifier).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (key in KEY_TO_TOOL) {
        e.preventDefault();
        setTool(KEY_TO_TOOL[key]);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedOverlayId) {
          e.preventDefault();
          removeOverlay(selectedOverlayId);
          setSelectedOverlayId(null);
        }
        return;
      }

      if (e.key === 'Escape') {
        setSelectedOverlayId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    setTool,
    setSelectedOverlayId,
    selectedOverlayId,
    removeOverlay,
    undo,
    redo,
  ]);
}
