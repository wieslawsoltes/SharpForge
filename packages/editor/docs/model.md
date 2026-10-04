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
