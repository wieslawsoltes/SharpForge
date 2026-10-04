# Preparing a source save

`editor.prepareSave({signal, onProgress, chunkSize, batchSize})` returns the
existing immutable source snapshot synchronously when save normalization is
disabled. This path reads no source characters or logical lines and does not
create undo history. The default editor preserves existing line endings unless
`endOfLine` was explicitly configured.

When trailing-whitespace removal, explicit line-ending normalization or a final
newline is requested, the method returns a promise. Callers must await it before
capturing the source to write or marking a document saved. The standalone
example follows this contract. A native Save As caller opens its picker first,
then invokes preparation through the workbench save provider's `prepare`
callback so browser activation is retained.

The normalizer uses indexed line boundaries. It reads at most 65,536 UTF-16 code
units in a window, scans trailing whitespace backward, and yields between large
whitespace windows or bounded line batches. Already matching EOL metadata skips
unnecessary terminator scanning. It removes ASCII space/tab trailing characters;
other whitespace remains significant. The work retains a captured immutable
root, never a whole-line string. `chunkSize` accepts 1–65,536 code units and
`batchSize` accepts 1–256 lines/edits.

Edits are prepared through `model.prepareEditsAsync` before one contribution-aware
commit. The editor's current view selections bind at that boundary, and undo
restores the pre-save source and selection state as one operation. The existing
buffer edit-count limit applies; exceeding it rejects the complete preparation
instead of applying a partial set of lines. Large deleted whitespace still has
to be retained as operation history, but its inverse is constructed in bounded
windows rather than one synchronous whole-line read.

Cancellation (`AbortError`), a disposed/replaced model, a changed source root,
changed text options (`SFEDITOR_SAVE_STALE`), read-only state and preparation
errors leave the model untouched. A source edit made by the user while
preparation runs remains intact; normalization never silently relocates edits.
An error from a subscriber after the final commit does not roll back published
text. Actual disk success is a separate boundary: the caller marks only the
captured successful version saved.

`saveTextEdits(modelOrSnapshot, textOptions, controls)` remains the synchronous
compatibility calculation for bounded callers. `saveTextEditsAsync` exposes the
same pure calculation with cancellation and cooperative scheduling. Explicit
`normalizeLineEndings:false` disables terminator conversion in these helpers;
the editor facade supplies its configured EOL policy automatically.

Focused fixtures are `tests/a20-save-normalization.test.js`,
`tests/text-cooperative-edits.test.js`, and
`tests/a20-save-preparation-flow.test.js`. They include an actual 200 MiB source,
bounded logical-line reads, cancellation, stale roots, ownership, exact undo,
and picker-before-preparation order. Qualification runs after the complete save
follow-up; exact results are retained in `../VIEW-COVERAGE.md`. Node fixtures
do not establish browser activation, input-latency or physical disk guarantees.
