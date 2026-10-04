# Source buffer lifetime

The workspace session owns lazy editor admission and release. A closed source that can be read again from an attached
provider retains only `{path, size, lazy: true, version, lastModified?}`. Directory handles and independent SHA-256 save
baselines remain attached. Reopening reads current provider bytes, preserves their encoding, and advances the document
version before the source enters the compiler worker again.

`session.closeRecord(path, {signal})` runs after the host has removed the tab from `state.tabs`. It checks that no split or
detached window still displays the document, compares exact encoded bytes against the physical baseline, and rechecks
workspace identity, membership, revision and source version after hashing. Its result is `{path, evicted, reason?}`.
Closing a clean source removes its editor and docking content, `state.files` buffer, project/folder source contents and
the ProviderDiskWorkspace text/bytes. The optional worker hook releases only that exact source version and its parsed tree.

Dirty sources, generated sources, read-only records, permission-denied recovery buffers, unresolved merge/reload choices,
active operations and sources with no independent backing provider retain their contents. Unmarked edits are detected by
the byte comparison and retained. Version exhaustion is an explicit retention result. Cache eviction never writes disk,
changes project membership or marks files dirty.

`session.loadRecord(path, {signal})` serializes competing open/close intentions for that path. `session.retainRecord(path)`
cancels an older pending close when a materialized source is reopened synchronously. Workspace replacement disposes all
pending intentions. `ProviderDiskWorkspace.load` invokes its synchronous `beforeAdmit(record)` guard after all awaited byte/hash/
handle work, before publishing contents or save baselines. Async guards are rejected without publishing a partial record.

The compiler worker module `workers/document-lifecycle.js` registers `releaseDocuments` with a bounded array of
`{uri, version}` requests. The entire input is validated first; a release arriving after a newer source version is ignored.
`syncWorkerDocuments` preserves the existing complete-source-set synchronization contract. A later build may load and
parse its closed compilation inputs again, under the existing source byte budget.

## Host composition

The Studio entry point binds these session host callbacks:

- `isDocumentOpen(path)`: check docking splits and detached windows in addition to `state.tabs`.
- `releaseDocumentView(path)`: call `releaseWorkspaceEditorView({editors, docking, onReleased}, path)`; clear the active
  editor reference if it matches the released instance.
- `canReleaseDocument(path)` and `releaseDocumentCaches(path)`: delegate to the SolutionExplorer methods of the same
  purpose. Recovery keeps a numeric revision/hash watermark and releases old source bodies and merge baselines. Queued
  obsolete digests cannot republish evicted source text. Search/watch views adopt the current metadata snapshot.
- `releaseCompilerDocuments(documents)`: call the compiler client's `releaseDocuments` directly, without preparing a
  project compilation request that would immediately reload the closed sources.
- `renderDocuments()`: refresh tabs and Explorer after eviction while allowing `state.active` to remain empty when the
  last tab closes. A closed buffer must not become active merely because another loaded source exists.

Both docking close and the editor `:q` command use the same session close method. The synchronous `openFile` path calls
`retainRecord` before opening; lazy navigation awaits `loadRecord` before `admitWorkspaceSource`.

## Qualification

`tests/a24-editor-lifecycle.test.js` composes the real session, ProviderDiskWorkspace, providers, Workspace syntax cache and
Explorer persistence. It covers 5,000 provider entries, repeated bounded open/close, current-byte reopening, exact-version
worker eviction, identity/membership/read races, cancellation, protected sources and both docking content maps.
This focused Node composition does not qualify a locked Studio entry point or browser/OS integration; those are recorded
separately in the Project18 evidence manifest. The host hooks are reviewable independently while the Studio lock is held.
