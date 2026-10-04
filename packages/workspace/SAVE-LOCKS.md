# Shared save ownership

Tracks [SF-A24-T11.2](https://github.com/wieslawsoltes/SharpForge/issues/3226).

`new WorkspaceSaveLocks({identity, locks})` accepts an opaque physical-workspace
identity and a Web Locks-compatible service. A display name is insufficient as an
identity: directory hosts must bind it using actual handle identity before saving.
Unavailable locks reject with `SFW1413`; disposed coordinators reject with `SFW1412`.

`guardedSave({path, expectedHash, read, write, signal})` rereads exact file bytes under
ownership. SHA-256 mismatch rejects with `WorkspaceSaveConflict` (`SFW1411`) before
write. A null expected hash means the file must not exist; omitting the baseline
is an error. The caller supplies byte reads and the eventual physical write.

Single-file saves hold a shared workspace lock and an exclusive path lock.
`run(path, action, {workspace: true, signal})` instead holds the same workspace key
exclusively for a whole multi-operation transaction. This coordinates saves with
journal mutations. `dispose()` aborts queued/active signals; adapters must respect
the signal when work can still be cancelled. The lock does not make physical writes
transactional and cannot undo a completed write. Registry persistence and Studio
directory binding are separate dependent batches.
