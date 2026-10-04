# Committed diagnostics during a visual rename preview

The model-owned preview publication batch keeps compiler and save inputs on the committed source root.
Studio also delivers analysis results directly through `CodeEditor.setDiagnostics`; that presentation path
must use the same identity boundary instead of interpreting committed offsets against temporary visual text.

`EditorPresentation` now normalizes incoming diagnostics against `publishedSnapshot()` and retains only the latest result
while the visual snapshot differs. The retained value includes the exact model and published source identity.
The actual `refreshPreview` route applies it after restoration/release, using the committed version; a changed model/source
or disposed view discards it. Empty results can clear earlier errors, and ordinary delivery remains immediate.
Range data is captured at delivery so later mutation of the caller's diagnostics cannot alter the deferred result.

This correction depends on the model preview lease/publication and shared-view repaint source owned by the docking batch.
`tests/a20-preview-diagnostics.test.js` contains seven source regression cases covering ordinary delivery, coalescing,
restore/release, empty results, secondary shared views, replacement identity, stale source, and disposal.
It exercises the real `EditorModel`, `RenamePreview`, and `EditorPresentation` with inert painting surfaces.
No tests or builds were run in this worktree; the parent's completed A19/A20 correction cohort will qualify the composed source.
The a4 hosted failures remain failed until their actual suites pass on a published correction.
