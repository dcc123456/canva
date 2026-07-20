# Redraw all detected text at detection time, not just edited text

> **STATUS: ROLLED BACK (2026-07-20)**
>
> This ADR was implemented and shipped, then reverted because the redraw pipeline
> lost style information that was previously preserved by the original PDF bytes:
> - **Bold/italic**: Source Han Sans CN Regular is the only CJK font bundled; no
>   bold variant exists. All redrawn CJK text uses Regular regardless of the
>   `bold` flag, losing the visual emphasis of bold headings in the original PDF.
> - **Color**: `matchColorsToAtoms` is approximate; some atoms miss their
>   matching coloredText entry and fall back to `block.color` (often `#000000`),
>   losing the original PDF's colored text.
> - **Font size**: preserved at the type level but unverifiable in practice
>   once the other attributes are lost.
>
> Until Source Han Sans Bold (and ideally Source Han Serif) is bundled and
> the color matcher is more robust, **only edited text blocks are redrawn on
> export**. Unedited blocks keep their original PDF bytes, which preserves
> all original styling. The architecture in this ADR remains the long-term
> goal once the prerequisites are met.
>
> See `exportPdf.ts` file header for the rollback rationale in code.

## Context

The previous architecture (README Decision #3: "矢量保留 + 编辑分离 + 导出统一管线") gated text redraw on whether the user modified the block:

- `text !== originalText` -> redraw with new style on export
- `text === originalText` -> leave original PDF bytes untouched

This produced a font-consistency problem. Unedited text retained the original PDF's embedded font (e.g. PingFangSC subset); edited text was redrawn with the mapped web-safe font (e.g. Source Han Sans). Editing a single character in a paragraph visually jumped the whole paragraph from one font family to another. The user perceived this as "the font changed when I edited".

Combined with ADR 0001 (web-safe font mapping), the cleanest fix is to redraw **every detected text block** with its mapped font at export time, regardless of edit state. This makes edited and unedited blocks render identically.

## Decision

At detection time (when `runEngineDetection` runs for a page), mark every detected text block as "needs redraw". At export time, every detected text block on every page goes through the full pipeline:

1. MuPDF redaction (byte-level erase of original text) or whiteout fallback
2. pdf-lib `drawText` with the mapped font from ADR 0001

The `text !== originalText` predicate no longer gates redraw. It may still be used for UI affordances (highlighting edited blocks) but not for export behaviour.

## Scope of "矢量保留"

"矢量保留" is redefined narrowly: only **non-text** content from the original PDF is preserved byte-for-byte. This includes:

- Raster images (`/Image` XObjects)
- Vector paths (lines, curves, filled shapes)
- Table borders drawn as path operators
- Embedded SVG / OCG content streams

All text content (`/Text` show-text operators and their font resources) is normalized to the mapped fonts. The original embedded font programs are discarded.

## Why redraw unedited text too

- **Consistency by construction.** If edited text uses mapped fonts and unedited text uses original embedded fonts, every edit boundary produces a visible font jump. There is no "gradual" fix short of redrawing everything.
- **Simpler mental model.** "What you see is what you get" applies uniformly. The user does not have to reason about which blocks have been touched.
- **Enables future features.** Search, copy-paste, accessibility, and reflow all benefit from a single canonical font set with a known cmap, rather than a mix of subsetted CID fonts with possibly-missing ToUnicode maps.

## Trade-offs accepted

- **Export cost.** Every export runs MuPDF redaction + pdf-lib redraw across every detected text block on every page. A 100-page document with 50 blocks/page = 5000 redraws. Estimated seconds; acceptable for an offline browser tool, would need re-evaluation for a server batch processor.
- **Original font fidelity lost.** A PDF set in a designer-licensed font (e.g. a custom brand font) gets normalized to Arial / Source Han Sans / etc. The user explicitly accepted this in ADR 0001; this ADR extends the loss from "edited blocks only" to "all blocks".
- **Subtle layout drift.** Mapped fonts have different metrics (kerning, advance widths) from the original. Line breaks may shift, paragraph reflow may differ. Acceptable: the user prioritized font-family consistency over positional fidelity.
- **Detection becomes mandatory for export.** If a page is exported without detection having run (e.g. user opens PDF and immediately hits Export without entering the `edit-text` tool), no text is redrawn -- the original PDF bytes pass through unchanged. This is the new "default" behaviour and is consistent with "user hasn't asked for normalization yet".

## What is NOT redrawn

- Pages that the user has not entered `edit-text` mode on. Detection is per-page; pages without detected text blocks retain their original text bytes.
- Text inside form fields (AcroForm). Those are handled separately by `formFields.ts` via pdf-lib's form API, not by the text-block redraw pipeline.

## Files affected

- `src/features/export/exportPdf.ts` -- the `editedTextBlocks` filter at line 108 (`if (editedTextBlocks.length > 0)`) becomes `if (allDetectedTextBlocks.length > 0)`. The redact edits list at line 80 expands to include every detected block on every page where detection has run.
- `src/features/text-edit/runEngineDetection.ts` -- when adding overlays, mark every block as "needsRedraw = true" (new field) regardless of edit state.
- `src/core/types.ts` -- consider adding `needsRedraw?: boolean` to `TextBlockItem`, or simply redefine the export predicate from `text !== originalText` to `!!detectedAt`.
- `README.md` Decision #3 -- update wording: "矢量保留" now means "non-text vectors preserved"; text is always normalized.
