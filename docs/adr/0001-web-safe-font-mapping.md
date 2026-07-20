# Map PDF fonts to web-safe font classes, not extract/re-embed embedded fonts

## Context

When a user opens the text editor (`F10`) on a PDF, the original PDF text was rendered by pdfjs using the PDF's embedded font (often a subsetted CID font). The text block detected by MuPDF reports the font **name** (e.g. `ABCDEF+PingFangSC-Regular`), but:

1. The TipTap overlay uses that name as `CSS font-family` -- browsers don't recognise subsetted embedded-font identifiers and silently fall back to the default sans-serif.
2. The export pipeline tries `extractEmbeddedFont` to pull the embedded font bytes and re-embed them via pdf-lib. This sometimes works for TrueType/CFF, but fails for Type1 fonts, CID fonts without a usable cmap, or when MuPDF reports a generic name like `"embedded"` / `"g_d0_f1"`.

The result: the in-editor overlay, the exported PDF, and the original PDF rendering look like three different fonts. The user cannot trust what they see while editing.

## Decision

Do **not** attempt to extract/re-embed the original embedded font. Instead, map every detected PDF font name to one of five canonical **font classes**:

| fontClass    | Concrete font (TipTap + pdf-lib) |
|--------------|----------------------------------|
| `sans`       | Arial                            |
| `serif`      | Times New Roman                  |
| `mono`       | Courier New                      |
| `cjk-sans`   | Source Han Sans (思源黑体)        |
| `cjk-serif`  | Source Han Serif (思源宋体)       |

The mapping is two-segment: PDF font name -> fontClass (by keyword/substring on the de-subsetted name) -> concrete font. The `block.font` field keeps the original PDF name for debugging; a new `block.fontClass` field carries the resolved class.

TipTap loads Source Han Sans/Serif via `@font-face` from `public/fonts/` using the **same `.ttf` files** that pdf-lib embeds, so the two renderers always use the same font bytes.

## Why not extract/re-embed

- CID/Type1 fonts can't reliably round-trip through `doc.embedFont(bytes)` in the browser: `drawText` needs a Unicode -> glyph cmap that subsetted CID fonts often lack, producing garbage or `?` fallbacks.
- The browser has no way to load an arbitrary embedded font program as a CSS `@font-face` source without a separate code path per format (Type1, CFF, TrueType, CID), each with its own failure modes.
- Even when extraction succeeds, glyph metrics differ between the subsetted original and the re-embedded copy, producing subtle layout drift on export.

## Trade-offs accepted

- **No pixel-level fidelity to the original PDF.** A paragraph set in PingFangSC will display as Source Han Sans in the editor and export. The shapes are different; only the *category* (sans CJK) is preserved. The user accepted this in exchange for stability.
- **Bold/italic detection stays name-based** (keyword list on the de-subsetted font name), since we no longer parse the font program. "Heavy", "Black", "Ultra" are added to the keyword table to catch cases "bold" misses.
- **Mixed-font blocks (e.g. a Helvetica word inside a Times paragraph)**: each atom computes its own `fontClass` independently. A single block can contain atoms mapped to different classes (e.g. a Times body with an Arial inline word). The segment built from those atoms inherits each atom's fontClass, so per-segment font identity is preserved.

## Scope of consistency

- **Edited text blocks**: detection -> TipTap overlay -> pdf-lib redraw all use the same `fontClass` -> same concrete font. Consistency by construction.
- **Unedited text blocks**: also redrawn on export (see ADR 0003). Original PDF bytes are only preserved for non-text content (vectors, images, table lines). Text content is normalized to mapped fonts across the whole document.

## Files affected

- `src/core/engine/types.ts` -- add `fontClass` to `TextBlock`.
- `src/core/types.ts` -- add `fontClass` to `TextBlockItem` and `RichTextSegment`.
- `src/core/engine/fontClassify.ts` (new) -- name -> fontClass mapping + keyword tables.
- `src/features/text-edit/RichTextEditor.tsx` -- resolve fontClass to CSS font-family instead of using `block.font` directly.
- `src/core/writer/textBlockEdits.ts` -- resolve fontClass to pdf-lib font instead of `extractEmbeddedFont`.
- `src/core/writer/fontExtract.ts` -- deleted (no longer needed). CJK font loading stays in `cjkFont.ts`, extended to load both Source Han Sans and Source Han Serif.
- `public/fonts/SourceHanSansSC.otf`, `public/fonts/SourceHanSerifSC.otf` (new) -- shared font files.
