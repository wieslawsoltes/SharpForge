# Durable workspace recovery

Recovery schema version 1 retains loaded text/exact binary bytes, explicit bounded
lazy membership, document versions, empty folders, open tabs, dirty paths and
workspace settings. `migrateWorkspaceRecovery` accepts historical 0.6–0.14 layouts
and overlays newer editor records onto physical metadata without inventing empty
content. It preserves original Unicode spelling and read-only/generated flags.
Malformed paths, aliases, invalid byte metadata and newer formats reject explicitly.
Credentials, trust and permissions are stripped through the shared identity
foundation's `sanitizeRecoveryValue`; recovery never grants execution authority.

`encodeRecoveryRecord` and `decodeRecoveryRecord` serialize a SHA-256-verified
envelope. `inspectRecoveryRecord` can quarantine corruption with its original text
and diagnostic; a newer envelope is preserved for a compatible application.
`readLegacyWorkspaceRecovery` reads old settings without deleting the source keys.

`OpfsRecoveryStore({storage, directory, name, onWarning})` writes an inactive
checkpoint slot, closes it, then commits the current/previous manifest. Failed
manifest writes retain the last committed generation. Corruption falls back to the
prior verified slot and records a diagnostic. Quota fallback preserves loaded text
and lazy membership, explicitly listing loaded binary payloads omitted for space.
If even the reduced snapshot does not fit, the previous checkpoint stays intact.
`requestPersistence()` reports the actual storage persistence outcome; it is not a
promise that browser storage cannot be evicted.

`WorkspaceReceiptStore({directory, maxEntries, maxSnapshotBytes})` composes with the
journal's `store.save` hook. Before/after byte snapshots are written once per receipt;
each completed physical primitive updates a small checksummed progress manifest.
Defaults retain 32 receipts with a 256 MiB combined snapshot budget. `load` exposes
the last receipt and exact partial completion; it does not silently replay disk I/O.
Both stores reject disposed access and support cancellation where writes can still
be stopped. File-system primitives already completed cannot be undone by abort.

This batch qualifies storage sequencing/fault injection against a deterministic
File System Access-shaped handle on Node. Actual OPFS availability, browser eviction,
recent-directory permission prompts and Studio restore UI are dependent host scopes.
