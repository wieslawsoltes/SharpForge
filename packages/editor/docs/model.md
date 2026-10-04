# Document models, selections and undo

`EditorModel` owns one `TextBuffer`, operation-based history, selections, scroll state, and decorations. Editor views bind to this object instead of retaining complete document strings in a per-URI map. `value` is a lazy compatibility string; hot paths use `getText`, line access, and incremental edits.

```js
const model = new EditorModel('one\r\ntwo', { uri: 'Program.cs', undo: { maxOperations: 1000 } });
model.setSelections([{ anchor: 0, active: 3 }, { anchor: 5, active: 8 }], { primaryIndex: 1 });
model.applyEdits([
  { start: 0, end: 3, text: 'ONE' },
  { start: 5, end: 8, text: 'TWO' }
], { command: 'uppercase', undoStop: true });
model.undo(); // one operation restores both texts, selection directions, and primary selection
```

## Selection contract

Selections use `{anchor,active}` UTF-16 offsets. `{anchor,head}` is an accepted alias; normalized results expose `head === active`, `start`, and `end`. Ranges are sorted and overlapping/touching selections merge deterministically, preserving primary direction. `SelectionSet` can be owned independently by split views that share a document buffer.

`normalizeSelections`, `transformOffset`, and `transformSelections` make edge affinity explicit. Collapsed carets track inserted text to the right; range anchors preserve outer edges. Model selection notifications are separate from text change notifications.

Multi-caret functions cover add/remove/collapse, next/all occurrences, and line-end carets. `replaceSelections` performs every caret edit in one transaction. Box selection records visual columns rather than treating columns as UTF-16 indices. Tab interiors expand into equivalent unselected spaces during editing; short rows retain virtual-space padding. Clipboard functions return plain text and optional versioned metadata; matching fragment counts distribute per caret, including fragments containing newlines. Rectangular paste grows missing lines in the same undo operation.

`addNextOccurrence(model,options)` starts after the primary selected range and
uses the text package's indexed single-match navigator. Earlier matches do not
consume a result page or cause premature wraparound. Existing selections are
excluded, including empty carets inside a candidate. The command admits at most
10,000 selections and reports capacity or search-budget exhaustion before
changing the selection set. Its `signal`, `maxSteps`, `timeLimitMs`, `matchCase`
and `wrap` options are explicit; the default synchronous search budget remains
2,000,000 steps and 25 ms. `addAllOccurrences` retains its separate capped
find-all behavior and rejects a truncated result.

`boxSelectionEdits` and `boxSelectionText` share the same geometry for editing and copying. Wide graphemes remain indivisible when a rectangle intersects only one of their visual cells. `padVirtualSpace:false` lets deletion leave short rows unchanged. Box insertion defaults to a 16 Mi-character combined payload budget, including tab splitting, virtual padding, and newly created clipboard rows; `maxInsertedCharacters` explicitly configures that budget up to one billion UTF-16 code units. Exceeding it rejects preparation before any model edit.

## Undo and dirty state

`UndoStack` stores forward and inverse edits, selection snapshots, command identity, and a persistent linked sequence within each coalesced group. It never stores a complete document value. A 500 KB document can retain 1,000 one-character undo groups with 1,000 retained payload characters.

Typing/deletion coalesces only when command identity, selection continuity, time interval, and save/explicit barriers permit it. `beginUndoGroup`/`endUndoGroup` support explicit nested command grouping. An open explicit group overrides individual command undo stops and selection jumps, so a macro or snippet input plus linked mirrors remains one undo action. Begin the group before the first edit and close it in `finally`. `pushUndoStop` creates a boundary between ordinary commands. `markSaved` records a state identity; undoing or redoing to it restores clean state. History count limits are independent of document length. `statistics` reports retained groups, operations, and payload characters. `stateId` is the current history identity; it returns to the captured identity on undo/redo and is suitable for compatibility cleanliness tokens, unlike the monotonically increasing buffer version.

`applyEdits` accepts `{selections,primaryIndex,command,time,undoStop,source}`. The `time` value and undo clock are injectable so behavior tests are deterministic. All edits in one call create one operation; all five carets typing a character undo together.

## Atomic workspace integration

1. Prepare every participant through `model.prepareEdits`.
2. Validate participant versions and workspace permissions before mutation.
3. Capture checkpoints for fault rollback, then commit each participant with `{notify:false}`.
4. After all root swaps succeed, call `emitChange` for each participant.

`checkpoint`/`restoreCheckpoint` include buffer root/version, undo state, selections, and scroll. Notification callbacks never run in the no-notification commit phase. If a later participant rejects a change, the workspace can restore every checkpoint before any listener observes partial state. Listener failures after publication do not retroactively roll back committed text.

The direct `.buffer` API bypasses editor history. User editing commands should use `model.applyEdits` or the editor facade's transaction method. Several views can share one `EditorModel`; each view can additionally keep a `SelectionSet` for independent local caret/scroll state. Disposing an injected model buffer remains the owner's responsibility.

### Temporary previews and published source

`snapshot()` remains the current visual source. Workspace, compiler, export,
recovery and save consumers use `publishedSnapshot()`: ordinarily it returns
the same immutable root, including during normal `{notify:false}` atomic swaps.
Only an explicit preview lease retains a separate committed root. Its source,
version and length must be read together; do not pair a published root with the
visual `model.version` or `model.length`.

`beginPreview()` returns an opaque model-bound lease whose `source` is the
committed snapshot. The owner passes `{previewLease: lease}` to `prepareEdits`
and commits with `{notify:false}`. Preview writes update visual source and
selections without recording undo or acquiring a source notification token.
`restorePreview(lease)` restores the original buffer, selections and scroll,
retaining ownership for the next preview. `endPreview(lease)` restores and
releases ownership; repeat release returns false. Release before preparing and
committing the real workspace edit. A stale lease cannot release a newer lease.

Normal model writes, undo/redo, competing previews and checkpoint restoration
reject with `SFEDITOR_PREVIEW_ACTIVE` during a lease. `markSaved()` still records
the committed history identity: preview edits never entered that history, and
restoration does not roll back saved markers acknowledged during preview.
`previewActive` reports ownership; `editOwnershipEpoch` is a monotonic generation
for asynchronous preparation. Acquire, release and invalidation advance it;
restoration never rewinds it. Prepared edits, rebinding, checkpoints and save
normalization reject stale ownership with `SFEDITOR_PREVIEW_STALE` (or the save
boundary's `SFEDITOR_SAVE_STALE`), even after exact root/version restoration.

`emitChange(event)` consumes a private, single-use token created by an actual
normal commit or history operation. Already committed atomic changes still
notify if an earlier listener acquires a preview on another participant.
Preview, uncommitted, rolled-back and replayed events cannot publish source.
This preserves root-swap-before-notification semantics without a batch-wide lock.

The lease guards **model APIs and public workspace routes**, not arbitrary direct
access to an independently owned `TextBuffer` or `UndoStack`. An external buffer
write is detectable by snapshot identity: the next published read, preview write,
restore, release or disposal invalidates the lease and reports
`SFEDITOR_PREVIEW_STALE`; it never restores over the externally advanced source.
The model does not synthesize history or model notifications for such low-level
writes. Disposal cleans up even when reporting that stale ownership error, and
never disposes a borrowed buffer. Hosts must route ordinary edits through the
model and treat direct buffer/history mutation as their own synchronization work.

### View-state ownership during replacement

`CodeEditor` binds models through its constructor and `setModel`. The supplied
`session.models` registry remains authoritative when its owner removes a document
or replaces a model at the same URI. `saveViewState` and view disposal never add
models back to that registry. They save folding, selection and scroll state only
while the registry still contains the exact model displayed by that view.

Cached view state is associated with a model identity as well as its URI. Switching
back to the same retained model restores its local caret, scroll, folding,
bookmarks and change tracking. Binding a different model at the same URI starts
from the replacement model's selections and new view services. Disposing a
standalone view retains its registered models for the session owner to dispose.

`CodeEditor.prepareViewState()` cancels/releases an owned rename before persistent
view state is captured. `saveViewState()` invokes it before storing selections,
scroll and folding; model switches and disposal therefore use committed source.
DocumentService calls every closing view's preparation hook before capturing
any of them, so a secondary view cannot cache a shared model's temporary state
before the preview-owning view is released. The hook also aborts asynchronous
rename resource staging through the widget's existing cancellation ownership.

### Cooperative prepared transactions

`buffer.prepareEditsAsync(edits, options)` and `model.prepareEditsAsync` accept
an ordered iterable of non-overlapping edits in original UTF-16 coordinates.
Unlike the synchronous array API, this streaming preparation does not sort its
input. It validates the existing buffer `maxEdits` limit (100,000 by default),
builds a private persistent tree and constructs inverse payloads in bounded
windows. It returns the same explicit prepared/commit protocol. Neither the
document revision, notifications nor undo history changes during preparation.

Controls include `signal`, `chunkSize` (1–65,536 code units; default 65,536),
`batchSize` (1–256 edits; default 128), `onProgress` and an optional `check`
callback for an owner's additional identity guards. Normalized CRLF insertions
may inspect one additional code unit at a chunk boundary. Cancellation rejects
with `AbortError`; any source-root/version change rejects with
`TEXT_VERSION_MISMATCH`. Disposal, invalid ranges, unordered/overlapping input
and edit-limit violations reject before commit. Large deletion history still
retains the deleted payload, as required for operation-based undo; preparation
does not construct a full unchanged-document string.

`model.bindPreparedEdits(bufferEdit, options)` binds an owned, current buffer
preparation to model selection state. `beforeSelections` and
`beforePrimaryIndex` select the originating view without changing the model.
`editor.commitPrepared(modelEdit)` uses this seam to bind the latest view
selections and run the same `beforeEdit`/`afterEdit` contribution boundary as
ordinary edits. The commit creates one model version and one undo operation;
adjacent deletions retain one unambiguous inverse insertion range.

The preparation windows are implementation bounds. Actual browser scheduling,
large undo latency and the cost of downstream event subscribers need separate
qualification; no frame-time guarantee follows from the Node fixtures.

## Exact visual status columns

`model.visualColumnAtOffset(offset,{tabSize:4,ambiguousWidth:1,signal})` returns a promise for the zero-based visual column on the offset's logical line. `cachedVisualColumnAtOffset` returns an exact number or `null`; it reads at most one bounded chunk when a sparse checkpoint is close enough. `positionAt(offset).character` remains the line-relative UTF-16 position for a status bar's **Ch** field. Add one to the visual result for a one-based **Col** field.

The index is created lazily and shared by every view of the model. Defaults use 4,096-unit chunks, 8,192-unit checkpoint spacing, at most 32 cached line/style pairs, 32,768 sparse checkpoints, 256 recent answers per pair and 64 pending requests. The first large-prefix lookup yields after 65,536 scanned units or an 8 ms scheduling slice. A chunk may read one extra unit to keep a surrogate pair intact. Numeric grapheme state crosses chunks without retaining an unfinished cluster's text. Sparse checkpoints coarsen when the configured memory budget is full; document length has no separate visual-column cutoff.

Edits retain unaffected line indexes and the prefix checkpoints before the earliest changed part of a line. Silent workspace commits and checkpoint restores are checked against snapshot identity before every query and scan slice. A changed snapshot rejects pending requests with `TEXT_VERSION_MISMATCH`; cancellation uses `AbortError`/`VISUAL_COLUMN_CANCELLED`. Disposal and capacity failures have `VISUAL_COLUMN_DISPOSED` and `VISUAL_COLUMN_LIMIT` codes. Read-only state does not prevent a coordinate lookup.

A status consumer should render an explicit pending state while awaiting an uncached result, cancel its preceding request when the caret moves, and compare the captured model, version and caret before displaying the result. No estimated column is returned as exact. `visualColumnStatistics` exposes scan units, chunks, yields, hits, checkpoint count, cached line count and pending count for qualification. Pass `{visualColumns:{...indexOptions}}` to the model constructor to configure index resources or inject scheduling for deterministic tests.
