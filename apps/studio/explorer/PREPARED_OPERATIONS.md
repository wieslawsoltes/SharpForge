# Prepared source file operations

Explorer composes the workspace transaction journal with DocumentService ownership.
A transaction captures immutable source and saved-baseline roots, validates the whole
operation batch, performs provider admission under the workspace save lock, and then
adopts editor models once. The journal and `FileOperationHistory` are the single undo
and redo authority. The Explorer inspection view exposes the same immutable records
without retaining mutable models.

Prepared source records are never flattened for history, hashing, project membership,
or model adoption. The workspace package hashes bounded encoded ranges. A physical
provider write materializes only its explicitly bounded byte payload. Existing raw
bytes are reusable only while their original source root still matches the current
snapshot. A replacement editor model preserves that provenance; it cannot mark stale
bytes as a new original. URI relocation creates a new model and keeps unchanged
editors owned by DocumentService.

The app's `ExplorerSourceTransactionAdapter` reuses provider transactions and adds
one C# admission step over the completed staged records. Changed or relocated text
is checked through `encodedWorkspaceSourceChunks` before physical effects. This
rejects NUL, unpaired surrogates and a leading U+FEFF without a separate BOM marker,
which the strict source reader cannot safely reopen. Validation is chunked and
cancellable; it does not flatten the source or add an application dependency to
the workspace package. XML validation likewise prefers an explicitly supplied
write string over any older prepared record in the operation.

The commit payload includes `documentStates`, `dirty`, `persistedPaths`, `restore`,
and the optional resource-plan `validate` guard. Directory writes mark only completed
paths clean; unrelated unsaved buffers remain dirty. Created or copied preview sources
start with no saved baseline. A host error with `committed: true` describes an observer
failure after adoption. It retains adopted models and advances the same undo or redo
stack, while a precommit failure releases only staged models.

Studio's explicit limits permit 20,000 items, 256 MiB per source file, 320 MiB of
imported encoded bytes, and 640 MiB for the staged in-memory record estimate. Explorer
history retains up to 32 entries within a 1,280 MiB before/after estimate; immutable
roots can share storage. Generic workspace transaction and history defaults are
unchanged. Native mutations retain their separate 16 MiB item and 4 MiB write-request
limits and encode prepared sources only at the native boundary.

`perform(operations, mappings, {signal, validate, label})` forwards cancellation and a
resource-plan guard through the journal and host adoption. Workspace replacement and
Explorer disposal cancel active imports. Add Existing Item admits the whole batch
before reading, reads browser C# files in bounded chunks, and transfers each prepared
model only after successful host adoption.

The final merged scope is covered by the existing A19 snapshot/resource tests and
A24 provider/history tests, plus `a24-explorer-prepared-journal.test.js` for exact
UTF-16 provider write/move/undo/redo, postcommit observer ownership, explicit XML
write precedence and rejected source-reader losses before physical effects. Qualification
is performed by the consolidated scope runner after all shared adapters are complete.
