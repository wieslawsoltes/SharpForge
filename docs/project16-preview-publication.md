# Project 16: committed source during inline rename preview

Work-ID: SF-A20-T19. Base: public `8d1be9cffa04b0fd7390e5cb6fe5f6c03b997557`.

The editor-only preview guard did not cover Studio's existing delayed analysis
or another editor's whole-project request. Both paths read DocumentService
records through StudioProjects and BuildService. Those records previously read
the visual model, allowing a temporary rename revision into the compiler's
monotonic workspace. Restoring the original revision then produced stale-source
failures. This is a source publication defect, separate from the already observed
hosted provider/view suite passes.

The model now owns a temporary preview lease and exposes `publishedSnapshot()`.
The regular `snapshot()` still describes the visible editor. DocumentService
records, save/state captures, model workspace adapters, project/compiler requests,
Explorer exports, diagnostics, EditorConfig, bounded range/size readers and
recovery limits all use a coherent published source/version/length. Normal silent
atomic transactions remain visible immediately; publication is not cached by
change events. The lease adds constant-size ownership state and constant-time
identity guards; no performance result is claimed for this follow-up.

Preview edits skip undo. Restore only resets visual buffer/selection/scroll,
preserving a save acknowledgement made while the preview was visible. Model
mutation and async preparation have explicit ownership guards, including the
prepare → preview → exact restore case. Real committed notification capabilities
are single-use and survive a reentrant preview acquisition in an atomic batch.
Directly changing a borrowed public buffer is outside this lock: stale ownership
is reported and released without overwriting that externally advanced source.

Rename UI ownership captures the exact model, not just a URI/version. Same-model
secondary views and CodeLens/legacy semantic commands cannot query temporary
coordinates. Other documents continue to query committed whole-project source.
Model replacement/removal releases the old lease. Apply is single-flight and
session-owned; Cancel/dispose propagate an AbortSignal through the resource host,
and an old async completion cannot close a newer rename dialog.
`prepareViewState()` releases an owned preview before CodeEditor persistence and
before any DocumentService close/reset view capture. Closing and reopening the
same model therefore cannot cache a temporary rename position.

Studio's composition must forward the optional signal at its existing callback:

```js
applyResourceTransaction: (plan, {signal} = {}) => applyExplorerResourceTransaction(plan, {
  documents: workbenchServices.documents, explorer: explorerActions, signal
})
```

Root owns that one composition change. The public editor adapter forwards the
signal without requiring a new native file transaction capability.

## Authored regression scope; execution pending

- `tests/a20-model-preview-publication.test.js`: visual/published roots,
  history/saved-marker preservation, model mutation rejection, stale sync/async
  preparation and rebinding, borrowed-buffer invalidation, disposal, atomic
  source visibility and notification ownership.
- `tests/a19-preview-source-publication.test.js`: real DocumentService →
  StudioProjects → BuildService/StudioExecution snapshot composition, another
  editor's whole-project request, monotonic Workspace synchronization, actual
  rename commit/undo, late save acknowledgement, capture/export/range/diagnostic
  readers, reload/adoption rejection, reentrant two-document publication,
  workspace replacement, close/reopen state and real Studio resource cancellation
  forwarding.
- `tests/a20-rename-preview-isolation.test.js`: retained compiler/provider
  regressions plus secondary views, CodeLens routes, actual insights controller
  model replacement, missing ownership, failed final commit, cancellation and
  overlapping async dialog ownership.
- `tests/a20-provider-transactions.test.js`: the stale low-level mutation case
  retains its assertion that externally advanced source is never restored over;
  ordinary model mutations now reject before changing that source.

These tests and source have not been executed in this lane. The parent owns the
serial completed-scope regression cohort and later hosted browser qualification.
Transport/DOM doubles in the Node fixtures are explicit; no new real browser,
native file permission, cross-platform or latency acceptance is claimed here.

## Initial parent cohort and fixture corrections

The parent completed the combined areas at source `80dfe3f5`: A19 had 748 cases,
746 passes and two failures; A20 had 712 cases, 702 passes, one failure and nine
existing explicit skips. The three failures were in these new fixtures. Both
Studio snapshot tests called the editor service name `documentSymbols` directly
on the compiler transport; production `studio-editor.js` maps that name to
`symbols`. They now use the actual protocol request and additionally assert the
exact `analyze`/`symbols` request sequence, retaining all source/version checks.
The no-normalization save view lacked CodeEditor's explicit default
`endOfLineExplicit: false`, so it incorrectly enabled EOL normalization. The
fixture now supplies that real default; the assertion that enabled normalization
rejects an active preview remains unchanged.

This correction was not executed here. Parent-owned affected-file retries remain
pending; do not report the original combined cohorts as all passing or add their
eventual overlapping retry counts to their original totals.
