# Workspace integrity contracts

The workspace package exposes versioned source buffers, byte-preserving file transactions,
recovery checkpoints, and explicit coordination between browser windows. The application owns
editor presentation and asks these services to admit changes. No service restores build trust,
credentials, origin grants, or native host tokens.

## Capabilities

| API | Supported behavior | Explicit boundary |
| --- | --- | --- |
| `Workspace` | Monotonic per-URI source versions across import, removal, reopening; configurable loaded byte budget | Compilation inputs must fit the configured budget |
| `WorkspaceTransactionJournal` | Preflighted ordered create/write/delete/move/copy/mkdir; before/after SHA-256; atomic buffer commit | Multi-file disk writes are not physically atomic; failed receipts list completed operations |
| `ProviderTransactionAdapter` | Complete provider preflight and physical byte mutations under one workspace lock; affected lazy files are materialized for undo | Folder operations reject untracked children; bounded snapshots must fit the file-operation byte budget |
| `WorkspaceReceiptStore` | Checksummed OPFS before/after snapshots and a durable progress receipt after each physical effect | Snapshot capacity and OPFS quota are admission limits; failed progress persistence reports partial completion |
| `FileOperationHistory` | Byte-bounded undo/redo with exact byte and membership restoration | Newer edits reject history application; entries larger than capacity are not retained |
| `reconcileWorkspaceFile` | Keep mine, take theirs, bounded three-way text merge | Divergent binary contents require an explicit selected version |
| `OpfsRecoveryStore` | Binary-safe checksummed double-buffered OPFS checkpoints; corrupt record quarantine; quota degradation | OPFS availability and quota remain browser capabilities; warnings enumerate omitted binaries |
| `RecentWorkspaceHandles` | IndexedDB structured-cloned folder handles and explicit permission request on reopen | Denied permission returns read-only recovery; execution trust is not granted |
| `WorkspaceRevisionChannel` | Workspace identity, presence, sender sequence, revision/hash notifications | A notification never overwrites a document |
| `WorkspaceSaveLocks` | Web Locks around re-reading the on-disk hash and writing | Without a locking implementation, cross-window guarded saves fail explicitly |
| `WorkspaceConflictCoordinator` | Explicit adopt-newer/keep-mine/merge, stale resolution rejection, propagated resolved revision | A host provides remote bytes and an atomic application callback |

## Transaction journal

```js
import {WorkspaceTransactionJournal, FileOperationHistory} from '@sharpforge/workspace';

let state = {records: [{path: 'App.cs', text: 'class App {}'}], folders: []};
const journal = new WorkspaceTransactionJournal({
  getState: () => state,
  commitState: async next => { state = next; },
  // Optional adapter: preflight(operations, {signal}), apply(operation, {signal}).
  // Optional persistent receipt store: save(receipt).
});
const history = new FileOperationHistory(journal, {maxBytes: 32 * 1024 * 1024});
await history.execute([
  {kind: 'move', path: 'App.cs', destination: 'Source/App.cs'},
  {kind: 'create', path: 'Source/Readme.txt', text: 'Moved together.'}
]);
await history.undo();
await history.redo();
```

The journal validates an isolated staged snapshot before touching disk. The persistent receipt
is written before external effects and updated after each completed disk mutation. A failure
retains the original in-memory buffers and throws `WorkspaceTransactionError`, whose
`completedMutations` and `receipt` describe precisely what reached disk. A storage failure
after memory commit is explicitly `committed-storage-failure`; the receipt does not falsely
claim rollback. Cancellation is checked before every external operation.
Studio directory operations persist their write-ahead receipt in the window's OPFS transaction
directory before the first physical effect. Before/after snapshot files are encoded once;
subsequent progress writes retain completed physical paths and the failure reason. Unloaded,
unaffected entries remain explicit metadata in the receipt. A missing durable receipt store
rejects directory mutation before disk changes.

`targetState` may accompany a journal execution to restore editor metadata together with the
file plan. Its file and folder hashes must equal the staged result before admission. This is
used by history and recovery so a second partial UI commit is unnecessary.

## Recovery format and migration

Recovery schema version 1 stores records, folders, settings, app descriptors, open documents,
active/entry/startup paths and breakpoints. `migrateWorkspaceRecovery` accepts historical
0.6–0.14 layouts, including `files` dictionaries, `documents`, and `diskRecords`. Unsupported
newer schemas are preserved and reported instead of being overwritten. Legacy explorer and
recent-template localStorage keys can be imported with `readLegacyWorkspaceRecovery`.
Records without retained contents must explicitly carry `{path, lazy: true, size}`. They retain
bounded membership, original Unicode spelling and optional modification/hash metadata. They do
not become empty files. Historical separate editor buffers override the corresponding disk
record text and version. Dirty paths and validated data settings survive migration.

`encodeRecoveryRecord` hashes the canonical sanitized payload. `decodeRecoveryRecord` checks
the hash before materializing records. OPFS writes the inactive snapshot and closes it before
atomically replacing the small current/previous manifest. On checksum corruption, the failed
payload and a report are copied to quarantine and the previous checkpoint is attempted.
Quota fallback retains unopened metadata and replaces omitted binary contents with explicit
lazy records marked `recoveryMissing: 'quota'`; warnings enumerate those binary paths. The full
file list therefore remains visible even when permission is needed to recover original bytes.

Studio's `restoreLegacyWorkspace` bootstrap returns `{restored, blocked, record, diagnostics}`.
It loads available editors read-only and neither builds nor overwrites the source storage key.
An unknown or corrupt record returns `blocked: true`; the caller must preserve it instead of
auto-saving a default sample. Unloaded project XML remains metadata until folder access is
granted. Reopening a granted recent handle reads actual files and restores open-document choices.

The Studio explorer binds directory identity by comparing persisted handles with `isSameEntry`
under an origin Web Lock. Same display names never connect unrelated folders. Portable hosts
can pass an explicit `coordinationIdentity`; unbound buffers receive recovery without editing
coordination. The explorer creates one OPFS directory per workspace identity and one child directory
per window. This prevents simultaneous dirty buffers from replacing each other's recovery
copies. Its restore action lists checkpoints by saved time and requires an explicit selected
checkpoint. Recovery does not auto-restore authority.

## Window conflicts and saves

Revision messages contain identity, sender, sender sequence, document path, revision, hash,
baseline hash, and optional resolution choice. Out-of-order or replayed sender messages are
ignored. A differing hash marks the local buffer stale; merging uses the explicitly retained
baseline and both versions. Local and remote hashes are checked again after any asynchronous
read, so a stale conflict dialog cannot apply to a newer buffer.

`WorkspaceConflictCoordinator` supplies `applyResolution` with the reviewed `expectedLocalHash`,
the exact selected `bytes` and `hash`, and the selected `content`, `revision` and `choice`.
The callback must reject a newer local version and commit the selected buffer atomically.
Studio binds this callback through `applyWorkspaceConflictResolution(host, session, resolution)`.
That helper verifies both byte hashes, preserves text encoding and delimiters, and marks the
accepted buffer dirty. Peer adoption and merging do not write the directory or advance its
physical baseline. Save-to-Disk performs the normal separate reconciliation and guarded write.
The helper has a 16 MiB conflict byte budget and rejects generated, read-only, unloaded and native
documents explicitly. Older file-operation undo or redo snapshots reject those newer buffer
changes instead of restoring a stale version over them.
A newer peer notification also invalidates a pending checkpoint read. If it arrives during an
already admitted atomic application, the chosen buffer is retained and the new conflict stays
visible; `resolve` returns `pendingConflict: true` so the host can ask for another review.
One resolution per document may be active; a competing request rejects with `SFW1425`.
Its observation state is retained only for the active request and released on success,
cancellation or failure.

`WorkspaceSaveLocks.guardedSave({path, expectedHash, read, write, signal})` acquires exclusive
ownership, reads current bytes, compares SHA-256, and only then invokes `write`. Two windows
using the same baseline result in one successful save and one conflict. All participating
save paths must use the same workspace identity and lock service.
File saves hold a shared workspace lock and an exclusive per-file lock; file-operation batches
hold exclusive workspace ownership through preflight, all physical mutations, and the buffer commit.
Their receipts enumerate individual completed writes/deletes/directories, and only persisted paths
clear dirty state. Unrelated dirty editors retain both their unsaved contents and previous disk bytes.

Studio's `createWorkspaceSave` composes these package contracts with `ProviderDiskWorkspace.save` and
the workspace session's atomic buffer commit. `host.chooseSaveConflict` supplies an explicit
`keep-mine`, `take-theirs`, or `merge` choice (or cancellation); the provided dialog previews the
two current versions and disables textual merge when a text baseline is unavailable. All choices
are collected before any write. The reviewed remote SHA-256 is checked again before save and
inside each guarded write. Adopted disk versions are checked again under the workspace lock.
The controller rejects changed workspace identities and stale buffers, retains edits made during
I/O, and reports exact completed physical writes if a later operation fails. A conflict whose
merged write completed while its editor changed retains a stale baseline deliberately, so the
next save requires another explicit decision rather than silently losing the remote merge.
The controller marks the session busy while resolving and saving so directory watches publish
only after a coherent save completion. Multi-file saves remain physically non-atomic.

## Runnable example and verification

Run `node examples/workspace-integrity.mjs` for a deterministic transaction/undo/redo and
three-way merge example. Focused regressions are in `tests/a24-workspace-*.test.js` and
`tests/a24-explorer-*.test.js`; browser API qualification is recorded separately from injected
directory-handle tests. `scripts/benchmark-a24-integrity.js` measures the complete hierarchy
build against an explicit git baseline and reports cold, median, p95, p99 and observed heap
delta. Heap delta is not a claim of total allocated bytes or peak process memory.
