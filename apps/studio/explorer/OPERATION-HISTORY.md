# Explorer operation history host contract

`createExplorerHistory(commands)` installs the public journal, bounded undo/redo history and physical
provider adapter. The command host supplies `context`, `commit`, `render`, optional `journalStore`, and
an Explorer persistence controller whose `ready` resolves physical identity and whose `saveReceipt`
durably stores progress. Operation families call `performExplorerOperations`; undo and redo call
`undoExplorerOperation`. This module does not register commands or replace the Studio entry point.

State capture includes records, folders, entry/startup, active document, tabs, breakpoints and dirty
paths. Commit receives `diskCommitted`, exact `persistedPaths`, remapped identities and preserved
unrelated dirty paths. A complete batch validates XML and bounded binary input before publication.
The retained project read set and operation identity reject changed preparation inputs.

Attached browser directories use the physical provider adapter. It reports completed primitives if a
later write fails; the host must surface those receipts and recovery choices. Browser history supports
undo and redo. Memory-only contexts use the same journal without physical effects.

Native contexts delegate mutation admission and quarantine to the explicit client contract. Binary
bytes and expected hashes are forwarded exactly, partial failures retain their undo token, and undo
refreshes reverse path mappings. Native redo remains explicitly unsupported until a fresh reviewed
mutation is available; deterministic client doubles are not native platform qualification.

The four focused cases cover complete XML refusal and binary undo/redo, actual provider writes with
unrelated dirty buffers, stale preparation inputs, and native partial-receipt forwarding. Their exact
projection run is pending the shared serial validation slot; actual Studio composition and browser
qualification belong to the dependent application integration.
