# Workspace transaction journal

`WorkspaceTransactionJournal({getState, commitState, adapter, store, validateContent,
limits})` stages mutations against an isolated snapshot. A workspace contains
`records` (path plus text or exact bytes), explicit empty `folders`, and optional
tabs, dirty paths, open documents, breakpoints and settings. The caller owns the live
state; `commitState` is invoked once after the entire plan and adapter succeed.

`begin({label, signal})` returns a one-use transaction. `add(operation)` accepts
create, write, mkdir, rename, move, copy and delete operations. `commit()` preflights
the complete resulting state; `rollback()` discards an uncommitted plan. `execute`
is the convenience form. Defaults allow 20,000 entries and 128 MiB of loaded
snapshot content; a transaction is limited to 20,000 operations. Cancellation,
disposed journals, overlapping commits, unsafe paths and case/Unicode-equivalent
collisions fail explicitly. Original Unicode path spelling is retained.

An optional adapter supplies `run`, `snapshot`, `preflight`, `apply` and `finalize`.
`run` owns the lock around the complete batch. `apply` reports completed primitive
mutations through its `onCompleted` callback, so progress can be durably persisted
before the next primitive. `store.save(receipt)` first receives `prepared`, then
each progress update and the final status. The host must provide an actual durable
store and physical adapter; this library does not infer disk access from metadata.

SHA-256 guards reject edits made during preparation or I/O. Memory publishes as a
whole. Filesystems may complete only part of a multi-file operation; failures expose
`WorkspaceTransactionError.receipt` and exact `completedMutations` without claiming
physical atomicity. A successful memory commit followed by adapter or receipt-store
failure retains an explicit committed-failure status.

`FileOperationHistory(journal, {maxBytes, maxEntries})` retains at most 32 entries and
32 MiB by default. Undo and redo compute inverse plans through the same journal,
preserve binary bytes and empty folders, and reject newer workspace edits before
overwriting them. `clear()` releases snapshots. The public state clone, validation,
hash and diff helpers use the same path and exact-byte rules as the journal.

Provider adapters, OPFS receipts and actual Explorer commands are dependent batches.
The focused tests in this batch exercise the complete host-callback contract on Node.

## Prepared sources and adopted errors

Operation records use the public immutable snapshot clone/hash contracts.
Mutable editor models remain host-owned. Explicit physical bytes are encoded
under provider limits before effects, and unrelated dirty overlays retain their
captured sources and baselines.

A host error with `committed: true` reports failed observation after adoption.
The journal finalizes once and preserves its committed receipt; history moves
its execute/undo/redo stack once before propagating that error. Rejected
admission does not advance history. See [prepared-source contracts](PREPARED_SOURCES.md).
