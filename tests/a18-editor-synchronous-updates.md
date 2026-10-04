# A18 synchronous editor decoration batching

## Measured remaining work

The coordinator's `browser-source-latency-03` run at `3495e504` used production build 10 and measurement-mode capture.
Its functional source, preview and cancellation assertions completed before the unchanged 16 ms renderer assertion failed.
Three of 513 renderer tasks exceeded the budget: a 49.258 ms accepted-result task and two real keypress tasks at 21.799 ms
and 17.916 ms. The keypress callbacks occupied 14.946 ms and 11.548 ms, respectively. Across 33 pending-input observations,
queue delay reached 3.7 ms, with a 1.3 ms p95. These are prior measurements, not results for this repair.

The separately captured `diagnostic-source-profile-02` uses the same built product with CPU sampling enabled. Its input
stacks attribute roughly 39 ms of cumulative sampled work to repeated `setEditorDecorations` calls and about 21 ms to
their viewport paints over the interaction. Sampling is diagnostic evidence rather than a per-key wall-clock result.
The existing overlay already paints a bounded visible window; its ParseHTML slices were approximately 0.5–1.9 ms.

## Repair and contracts

`CodeEditor.changed()` and `undo()` keep their existing history and callback ordering through an extracted internal module.
The existing viewport now owns a synchronous nested batch. Every `paint()` still prepares the latest `SourceText`, syntax
index and diagnostic data immediately. Its requested DOM synchronization waits until the outer publication returns, so
diagnostics, breakpoints, execution and selected-frame setters do not repeatedly paint intermediate states. The selected
and execution overlays also avoid assigning unchanged native `hidden` values. There is no delayed task or new viewport.

The final paint runs even when `onChange` throws before requesting decorations. Pending DOM synchronization runs in a
`finally` block, and the exception continues to the caller. Disposing inside a callback clears pending work and prevents
detached overlay writes. Native selection, synchronous source values, undo/redo records and mutable public values retain
their existing contracts. Intermediate decoration DOM inside a change/cursor callback now becomes final at the outer
change's return; standalone setters still render synchronously. The README records that boundary.

The remaining accepted-result worker task is owned by the coordinated Studio presentation change. This editor repair
does not claim to resolve that task or to establish the complete 16 ms browser criterion.

## Prepared verification

`a18-editor-synchronous-updates.test.js` has eight focused cases using the exported production `CodeEditor` and the existing
explicit DOM/input fixture. They cover a 3,000-line edit with synchronous source/diagnostic/history observations and one
final overlay/gutter assignment; standalone setters; nested source edits; exceptions before and after decoration setters
and in cursor callbacks; disposal with queued resize; undo/redo selection/history; and exact native visibility writes.
The fixture records DOM-boundary assignments without replacing editor, text, lexer or history algorithms.

Prepared root-owned command:

```sh
node scripts/limited.js node --test tests/a18-editor-synchronous-updates.test.js tests/a18-editor-viewport-lifecycle.test.js
```

The coordinator also owns the unchanged production source-latency browser workload and its before/after receipt.
No tests, checks, builds, benchmarks or browser jobs were executed by this branch. Post-repair median/p95 measurements
and native/browser outcomes remain pending. No existing assertion, performance threshold or validation gate was changed.

## Changes outside A18

The measured Studio source-edit path crosses into the editor package. The frozen editor entry module shrinks by extracting
its source-change and undo publication, while the already extracted viewport gains the nested synchronization scope.
There are no new package exports, dependencies, global caches, source-model shapes or public callback signatures.
The owning coordinator authorized this small cross-workstream correction under `SF-A18-T04.1` / issue #1682.
