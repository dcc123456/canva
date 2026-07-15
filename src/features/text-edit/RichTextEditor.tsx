/* eslint-disable react-refresh/only-export-components */
// features/text-edit/RichTextEditor.tsx
//
// TipTap 富文本编辑器封装。支持样式:
//   bold, italic, underline, strike, color, fontSize, fontFamily
// 空格和换行保留(preserve-spans + pre-wrap)。
import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Underline } from '@tiptap/extension-underline';
import { FontFamily } from '@tiptap/extension-font-family';
import { Text } from '@tiptap/extension-text';
import { Extension } from '@tiptap/core';
import type { Editor, JSONContent } from '@tiptap/core';
import type { RichTextSegment, TextBlockItem } from '../../core/types';

// ---------- Custom Text extension: preserve all whitespace -------------------
// ProseMirror's default text node trims/collapses whitespace per HTML rules.
// This extension forces preserveWhitespace:'full' so that spaces between
// font-runs (e.g. "Hello " + "world") are never lost during editing.
const PreserveText = Text.extend({
  parseHTML() {
    return [{ tag: '#text', preserveWhitespace: 'full' as const }];
  },
});

// ---------- Custom FontSize extension -----------------------------------------
// Adds fontSize attribute to the textStyle mark via global attributes,
// coexisting with Color and FontFamily.
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.style.fontSize || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}px` };
            },
          },
        },
      },
    ];
  },
});

// ---------- Style key for merge comparison ------------------------------------

function styleKey(seg: RichTextSegment): string {
  return [
    !!seg.bold,
    !!seg.italic,
    !!seg.underline,
    !!seg.strike,
    seg.color || '',
    seg.fontSize ?? 0,
    seg.fontFamily || '',
  ].join('|');
}

// ---------- RichTextSegment <-> TipTap JSON ----------------------------------

export interface BlockDefaults {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
}

export function segmentsToTipTapContent(
  segments: RichTextSegment[] | undefined,
  text: string,
  blockDefaults?: BlockDefaults
): JSONContent {
  const hasSegments = segments && segments.length > 0;

  const buildMarks = (
    seg: RichTextSegment
  ): { type: string; attrs?: Record<string, unknown> }[] => {
    const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
    const isBold = hasSegments ? !!seg.bold : (seg.bold ?? blockDefaults?.bold);
    const isItalic = hasSegments ? !!seg.italic : (seg.italic ?? blockDefaults?.italic);
    const isUnderline = hasSegments ? !!seg.underline : (seg.underline ?? false);
    const isStrike = hasSegments ? !!seg.strike : (seg.strike ?? false);
    const color = seg.color ?? blockDefaults?.color;
    const fontSize = seg.fontSize ?? blockDefaults?.fontSize;
    const fontFamily = seg.fontFamily ?? blockDefaults?.fontFamily;

    if (isBold) marks.push({ type: 'bold' });
    if (isItalic) marks.push({ type: 'italic' });
    if (isUnderline) marks.push({ type: 'underline' });
    if (isStrike) marks.push({ type: 'strike' });

    const tsAttrs: Record<string, unknown> = {};
    if (color) tsAttrs.color = color;
    if (fontSize) tsAttrs.fontSize = fontSize;
    if (fontFamily) tsAttrs.fontFamily = fontFamily;
    if (Object.keys(tsAttrs).length > 0) {
      marks.push({ type: 'textStyle', attrs: tsAttrs });
    }
    return marks;
  };

  const pushText = (
    content: JSONContent[],
    textPart: string,
    seg: RichTextSegment
  ) => {
    if (!textPart) return;
    content.push({ type: 'text', text: textPart, marks: buildMarks(seg) });
  };

  const content: JSONContent[] = [];
  const segs = hasSegments
    ? segments!
    : [{
        text,
        bold: blockDefaults?.bold,
        italic: blockDefaults?.italic,
        color: blockDefaults?.color,
        fontSize: blockDefaults?.fontSize,
        fontFamily: blockDefaults?.fontFamily,
      }];

  for (const seg of segs) {
    const parts = seg.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) content.push({ type: 'hardBreak' });
      pushText(content, parts[i], seg);
    }
  }

  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

export function editorToSegments(
  editor: Editor
): { text: string; segments: RichTextSegment[] } {
  const json = editor.getJSON();
  const raw: RichTextSegment[] = [];

  function processNode(
    node: JSONContent,
    inherited: {
      bold: boolean;
      italic: boolean;
      underline: boolean;
      strike: boolean;
      color?: string;
      fontSize?: number;
      fontFamily?: string;
    }
  ): void {
    if (node.type === 'text') {
      const marks = node.marks || [];
      const seg: RichTextSegment = { text: node.text || '' };
      if (inherited.bold || marks.some((m) => m.type === 'bold')) seg.bold = true;
      if (inherited.italic || marks.some((m) => m.type === 'italic')) seg.italic = true;
      if (inherited.underline || marks.some((m) => m.type === 'underline')) seg.underline = true;
      if (inherited.strike || marks.some((m) => m.type === 'strike')) seg.strike = true;

      const ts = marks.find((m) => m.type === 'textStyle');
      const attrs = ts?.attrs as Record<string, unknown> | undefined;
      const color = (attrs?.color as string) || inherited.color;
      const fontSize = (attrs?.fontSize as number | undefined) || inherited.fontSize;
      const fontFamily = (attrs?.fontFamily as string | undefined) || inherited.fontFamily;
      if (color) seg.color = color;
      if (fontSize) seg.fontSize = fontSize;
      if (fontFamily) seg.fontFamily = fontFamily;
      raw.push(seg);
    } else if (node.type === 'hardBreak') {
      const seg: RichTextSegment = { text: '\n' };
      if (inherited.bold) seg.bold = true;
      if (inherited.italic) seg.italic = true;
      if (inherited.underline) seg.underline = true;
      if (inherited.strike) seg.strike = true;
      if (inherited.color) seg.color = inherited.color;
      if (inherited.fontSize) seg.fontSize = inherited.fontSize;
      if (inherited.fontFamily) seg.fontFamily = inherited.fontFamily;
      raw.push(seg);
    }
  }

  function processParagraph(para: JSONContent): void {
    if (!para.content || para.content.length === 0) {
      raw.push({ text: '' });
      return;
    }
    for (const child of para.content) {
      processNode(child, {
        bold: false,
        italic: false,
        underline: false,
        strike: false,
      });
    }
  }

  if (json.content) {
    for (let i = 0; i < json.content.length; i++) {
      if (i > 0) raw.push({ text: '\n' });
      processParagraph(json.content[i]);
    }
  }

  // Merge adjacent segments with identical style.
  const merged: RichTextSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && styleKey(last) === styleKey(seg)) {
      last.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  const fullText = merged.map((s) => s.text).join('');
  return { text: fullText, segments: merged };
}

// ---------- Component ---------------------------------------------------------

export interface RichTextEditorProps {
  block: TextBlockItem;
  zoom: number;
  onCommit: (text: string, segments?: RichTextSegment[]) => void;
  onCancel: () => void;
  registerCommit?: (fn: (() => void) | null) => void;
}

export function RichTextEditor({
  block,
  zoom,
  onCommit,
  onCancel,
  registerCommit,
}: RichTextEditorProps) {
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const latestContentRef = useRef<{ text: string; segments: RichTextSegment[] } | null>(null);
  const committedRef = useRef(false);
  const [toolbarRect, setToolbarRect] = useState<DOMRect | null>(null);

  const doCommit = useCallback((text: string, segments: RichTextSegment[]) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommitRef.current(text, segments);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        listItem: false,
        horizontalRule: false,
        text: false,
      }),
      PreserveText,
      TextStyle,
      Color,
      Underline,
      FontFamily,
      FontSize,
    ],
    content: segmentsToTipTapContent(block.segments, block.text, {
      bold: block.bold,
      italic: block.italic,
      color: block.color,
      fontSize: block.fontSize,
      fontFamily: block.font,
    }),
    autofocus: true,
    onUpdate: ({ editor: ed }) => {
      latestContentRef.current = editorToSegments(ed);
    },
    editorProps: {
      attributes: {
        style: [
          'outline: none',
          `font-size: ${Math.max(8, block.fontSize * zoom)}px`,
          `line-height: ${block.lineHeight || 1.2}`,
          `font-family: ${block.font}`,
          `color: ${block.color || '#000000'}`,
          'padding: 0',
          'white-space: pre-wrap',
          'word-break: break-word',
        ].join(';'),
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          const ed = editor;
          if (ed && !ed.isDestroyed) {
            const { text, segments } = editorToSegments(ed);
            doCommit(text, segments);
          }
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancelRef.current();
          return true;
        }
        return false;
      },
    },
    onBlur: ({ editor: ed }) => {
      const { text, segments } = editorToSegments(ed);
      doCommit(text, segments);
      setToolbarRect(null);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const sel = ed.state.selection;
      if (sel.empty) {
        setToolbarRect(null);
        return;
      }
      const view = ed.view;
      const start = view.coordsAtPos(sel.from);
      const end = view.coordsAtPos(sel.to);
      const left = Math.min(start.left, end.left);
      const right = Math.max(start.right, end.right);
      const top = Math.min(start.top, end.top);
      setToolbarRect(
        new DOMRect(left, top, right - left, Math.max(start.bottom, end.bottom) - top)
      );
    },
  });

  useEffect(() => {
    if (registerCommit && editor) {
      registerCommit(() => {
        if (committedRef.current) return;
        if (editor.isDestroyed) {
          if (latestContentRef.current) {
            doCommit(latestContentRef.current.text, latestContentRef.current.segments);
          }
          return;
        }
        const { text, segments } = editorToSegments(editor);
        doCommit(text, segments);
      });
    }
    return () => {
      registerCommit?.(null);
      if (!committedRef.current && latestContentRef.current) {
        doCommit(latestContentRef.current.text, latestContentRef.current.segments);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const isBold = editor?.isActive('bold') ?? false;
  const isItalic = editor?.isActive('italic') ?? false;
  const isUnderline = editor?.isActive('underline') ?? false;
  const isStrike = editor?.isActive('strike') ?? false;

  const btnBase: React.CSSProperties = {
    padding: '2px 6px',
    borderRadius: '3px',
    border: '1px solid #d1d5db',
    cursor: 'pointer',
    fontSize: '12px',
    minWidth: '24px',
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <EditorContent
        editor={editor}
        className="tiptap-edit-area flex-1 overflow-auto"
        style={{ outline: 'none' }}
      />
      {toolbarRect && (
        <div
          style={{
            position: 'fixed',
            top: Math.max(4, toolbarRect.top - 36),
            left: toolbarRect.left + toolbarRect.width / 2,
            transform: 'translateX(-50%)',
            zIndex: 1000,
            display: 'flex',
            gap: '3px',
            padding: '3px 6px',
            background: '#fff',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          }}
        >
          <button type="button" title="粗体"
            style={{ ...btnBase, fontWeight: 700, background: isBold ? '#dbeafe' : '#fff' }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >B</button>
          <button type="button" title="斜体"
            style={{ ...btnBase, fontStyle: 'italic', background: isItalic ? '#dbeafe' : '#fff' }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >I</button>
          <button type="button" title="下划线"
            style={{ ...btnBase, textDecoration: 'underline', background: isUnderline ? '#dbeafe' : '#fff' }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >U</button>
          <button type="button" title="删除线"
            style={{ ...btnBase, textDecoration: 'line-through', background: isStrike ? '#dbeafe' : '#fff' }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >S</button>
          <input
            type="color"
            title="文字颜色"
            style={{ width: '24px', height: '24px', border: '1px solid #d1d5db', borderRadius: '3px', cursor: 'pointer', padding: 0 }}
            onMouseDown={(e) => e.preventDefault()}
            onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()}
          />
        </div>
      )}
    </div>
  );
}
