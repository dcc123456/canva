# Detect on PDF open, redraw page-by-page with first-paint priority

## Context

ADR 0003 decided that **every detected text block** is redrawn at export time with the mapped font. Combined with ADR 0001 (font mapping) and ADR 0002 (span-level color), the redraw pipeline is now the dominant cost of using the editor: every page of every opened PDF must be detected, whiteout'd, and re-drawn with mapped fonts before export.

Doing this synchronously at export time would freeze the UI for seconds on a multi-page document. Doing it lazily only when the user enters `edit-text` mode produces the inconsistent-font problem (visited pages normalized, unvisited pages keep original embedded fonts).

## Decision

Detection and redraw happen **eagerly**, with a priority queue:

1. **On PDF open**: synchronously detect the first page (current page). Redraw it. Show the result immediately.
2. **In a Web Worker**: continue detecting and redrawing remaining pages in page order.
3. **Export**: uses the redrawn pages that are ready; waits (with progress UI) for any pages still pending.

Detection is **per-page** and idempotent: re-running detection on an already-detected page replaces the previous text-block overlays for that page.

## Why eager + paginated

- **Consistency across pages.** If only visited pages are normalized, the user sees font jumps when scrolling into a fresh page. Eager background detection eliminates this.
- **First-paint priority.** The user opens a PDF to read the first page. That page must be ready immediately; other pages can wait a few seconds.
- **Worker offloading.** MuPDF and pdf-lib redaction are CPU-heavy; running them on the main thread blocks rendering. A Web Worker keeps the UI responsive while pages stream in.

## Trade-offs accepted

- **Memory.** Each detected page accumulates: MuPDF atoms, color-extraction entries, segment list, redrawn pdf-lib document. A 100-page document may use ~100MB of JS heap. Acceptable for an offline browser tool; would need eviction for tab longevity.
- **Worker setup cost.** MuPDF WASM (~30MB) loads per worker. If the worker is per-document, this is fine; if per-page, it's wasteful. Plan: one persistent MuPDF worker per editor session.
- **Export waits on pending pages.** If the user opens a 200-page PDF and hits Export 2 seconds later, the export blocks until all 200 pages finish. Progress UI must be honest about ETA; an opt-out ("export only visited pages") may be added later.

## What this is NOT

- **Not a streaming export.** The exported PDF is produced atomically after all redraws finish. Streaming the bytes out as pages complete would require a more complex pipeline (incremental PDF writing) and isn't worth it for an offline tool.
- **Not collaborative.** Single-user, single-tab. No cross-tab synchronization of detection state.

## Files affected

- `src/hooks/useEngineLoad.ts` (or new `useAutoDetectOnOpen.ts`) -- trigger detection when a PDF is loaded; priority queue + worker scheduling.
- `src/core/engine/worker.ts` (new) -- Web Worker wrapping MuPDF + pdf-lib redaction. Posts back per-page redrawn bytes.
- `src/features/export/exportPdf.ts` -- await pending detections before serializing; show progress.
- `src/store/engineStore.ts` -- per-page detection status (`'pending' | 'detecting' | 'ready' | 'failed'`).
