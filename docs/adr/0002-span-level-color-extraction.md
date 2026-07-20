# Extract span-level color, not block-level dominant color

## Context

`core/pdf/textColor.ts` already walks pdfjs's `getOperatorList()` to record per-showText `(text, color, x, y)` entries. `matchColorsToBlocks` then maps those entries to MuPDF-detected blocks by bbox overlap and takes the **most common** color per block. The result is stored on `TextBlock.color` (single hex per block).

This loses intra-block color: a paragraph with a single red word in otherwise black text reports `color: '#000000'`, and both TipTap and the exported PDF render the whole paragraph in black. The user sees the original PDF with the red word, the editor without it, and the export without it -- three-way inconsistency on a single character.

The same loss applies to size and weight changes within a block, but those are already preserved at the segment level by MuPDF's `preserve-spans` mode: each font-run becomes its own atom -> its own segment. Color is the only style attribute that currently leaks out of segment granularity.

## Decision

Extract color at **span granularity** (one color per atom/segment, not one per block).

Implementation:

1. `extractTextColors` already returns `(text, color, x, y)` entries with `x, y` in PDF y-up coordinates. Keep that interface; extend it to also return per-entry `width` and `height` (or bbox) so downstream matching can be precise.
2. After MuPDF detection in `core/mupdf/mupdfEngine.ts`, each atom already carries its bbox in y-down coordinates. Match atoms to colored-text entries by `bbox` containment/overlap (not just the block bbox), and set `atom.color` from the matched entry.
3. Propagate `atom.color` into `segment.color` when building segments. The existing segment-merge logic (which merges adjacent segments with identical `bold/italic/fontFamily/fontSize`) must add `color` to its style key.
4. `TextBlock.color` remains as the **block-level fallback** (for segments whose color couldn't be matched, or for the editor's default text color when typing new content).

## Why per-segment rather than per-block

- The data is already per-showText in pdfjs. The current code collapses it to per-block for convenience, throwing away fidelity that costs nothing to keep.
- `RichTextSegment` already has an optional `color` field; the type system already supports this. Detection just isn't populating it.
- Export (`textBlockEdits.ts`) already reads `seg.color || block.color` per segment, so once detection populates `seg.color`, export works without changes.

## Trade-offs accepted

- **Matching is approximate.** MuPDF's atom bbox is y-down; pdfjs's text matrix is y-up. We have to convert and use tolerance matching. Some atoms may not match (in which case they fall back to `block.color`); some may match the wrong entry in edge cases (overlapping showText operators within one atom). Acceptable -- the failure mode is "looks like the block color", which is the current behavior, not a regression.
- **Performance.** The current `matchColorsToBlocks` is O(blocks * coloredTexts). Atom-level matching is O(atoms * coloredTexts) where atoms >> blocks. For a typical page (~200 atoms, ~100 coloredTexts) this is fine. If a pathological PDF has 10k+ atoms, the matching can be index-accelerated later.
- **CMYK conversion stays simple.** `textColor.ts` already does naive CMYK -> RGB. This is unchanged; professional color management is out of scope.

## What stays block-level

- `block.color` is kept as the **default** for new text typed by the user into the block, and as the fallback for atoms that didn't match any colored-text entry. It's no longer the only color source.

## Files affected

- `src/core/pdf/textColor.ts` -- `extractTextColors` returns per-entry bbox; `matchColorsToBlocks` deprecated/removed in favor of `matchColorsToAtoms`.
- `src/core/mupdf/mupdfEngine.ts` -- add `color` to `AtomLine`, populate from `matchColorsToAtoms`, propagate to segment.color.
- `src/core/engine/pdfLibFallback.ts` -- same propagation (pdfjs path doesn't have MuPDF atoms but has per-item positions; can build per-segment color from there too).
- `src/core/pdfium/pdfiumEngine.ts` -- pdfium's per-character detection is currently a stub (one block per character); color extraction would work there too once the stub is replaced. Out of scope for this ADR.
- `src/features/text-edit/runEngineDetection.ts` -- remove the block-level color overwrite at lines 80-83 (now handled inside the engine).
