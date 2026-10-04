# A18 integration with the persistent editor

This integration is based on upstream `7bd1239a773de5eb5c904172aa1371f3fc196789` and the A18 integration
tree at `548b28993aec0ae25cc230995f0321e59357cb34`. It preserves the upstream `EditorModel`, persistent
text buffer, native keyboard profiles, multi-caret editing, hidden IME input and virtual view. The
source-latency fixes use these components; there is no second source model or textarea renderer.

## Publication and presentation

`editor.model`, `sourceSnapshot()`, `value`, `getSelections()`, diagnostics and native undo-stack state
are current during ordinary `onEdits`/`onChange` callbacks. Contributions invalidate the previous source
revision before consumer callbacks can publish new diagnostics. Nested edits preserve the newest source
and diagnostics, and restore the enclosing edit's ownership flag. A throwing consumer cannot leave the
already committed model without a scheduled presentation update.

The upstream virtual view coalesces `sync()`, diagnostic setters and source publication into one animation
frame. `paintViewport()` explicitly renders and consumes a pending frame. This supersedes the previous
A18 textarea implementation's synchronous outer-callback DOM flush: code requiring settled presentation
can explicitly render or await the view's frame. Source values and prepared diagnostics remain synchronous.
The upstream large-file policy retains its documented deferred full-text `onChange` callback; `onEdits`
remains the synchronous transaction event.

Visible text rows compare their bounded source text, syntax, source offsets and decoration classes before
replacing child nodes. Changed hover text updates existing spans, while whitespace, folds, font metrics,
semantic classes and execution spans invalidate the appropriate row. Scroll/resize continues to use the
existing virtual geometry and line pool. Disposal cancels pending frames and ignores queued resize work.

The public input element retains full-model `value` and global `selectionStart`/`selectionEnd` bridges.
Its native textarea storage is a bounded context around the active caret. Use `setValue`, `applyEdits`,
`setSelections`, `goto` and `focus` for programmatic editing; real input uses the native controller.
`history.length` and `future.length` expose native undo depths, not mutable arrays of source copies.

## Syntax snapshots

`SyntaxHighlightIndex.update(snapshot, event)` consumes the persistent model's original-coordinate edits.
`withSource(source, change?)` creates an independent immutable source index and validates explicit change
hints. Retained lexical results stay tied to their original source after later mutable model updates.
Viewport queries retain upstream token classification and lexical size/token budgets.

`index.brackets` is a complete, lazy map-like query over the current token stream. `index.pairs` explicitly
materializes the complete map. Cache endpoints inside a rescanned lexical window are discarded even when
a quote/comment edit leaves the same bracket-kind sequence. Chunked bracket coloring does not determine
the correctness of synchronous matching commands.

## Failed multi-document transactions

Capture short-lived checkpoints before mutation:

```js
const modelCheckpoint = editor.model.checkpoint();
const viewCheckpoint = editor.captureViewCheckpoint();
```

If a transaction fails, restore every participating model first. Then restore each captured view:

```js
editor.model.restoreCheckpoint(modelCheckpoint);
editor.restoreViewCheckpoint(viewCheckpoint);
```

The view checkpoint covers live session views sharing the model: independent selections/scroll, folding,
bookmarks and their history, change tracking, diagnostics/decorations, debugger lines and modal marks.
It rejects the wrong owning view/model/revision, including a reused numeric version with a different
persistent source snapshot. Disposed or subsequently switched secondary views are
left alone. Restoration cancels the failed transaction's delayed full-text callback and stale folding,
recomputes the large-file policy, refreshes diagnostic navigation, and rebuilds current syntax/layout.
Every eligible view has deferred work cancelled before restoration starts. A throwing presentation
contribution is reported after the remaining views have been attempted. Original measured scroll extents
are restored before native scrolling can clamp the saved logical position.
It emits no source edit and does not alter the separately restored undo stack or independently held
read-only lock. These checkpoints contain owner references and are intended for short-lived rollback;
long-lived designer history stores native `UndoStack` checkpoints and bounded source transaction data.

## Replacement and qualification

The former private `editor-changes.js`, `editor-viewport.js`, `highlight-index.js` and `highlight-runs.js`
modules are retired when this branch is merged into A18. The only syntax implementation is
`view/syntax-index.js`, exported through `highlight.js`; the only default editor is `core/code-editor.js`.
`highlight-brackets.js`, `source-change.js` and `html.js` remain small shared helpers.

Prepared A18 coverage uses the actual package exports and an explicit DOM/native-input/animation boundary:
six immutable highlight cases, five virtual viewport/lifecycle cases, eight publication/history cases,
and ten persistent-model/linked-view integration cases. Existing A20 model, folding, input, keymap and
view tests remain applicable. No test/check/build/browser job was run by the integration author.

The historical source-latency pass at `38ac41a4` (renderer maximum 15.952 ms, zero tasks over 16 ms) belongs
to the earlier textarea architecture. It is not evidence for this upstream integration. The coordinator
must rerun the combined editor/Studio tests and unchanged production browser workload against the merged
tree; native IME, assistive-technology and platform qualification retain their existing limitations.
