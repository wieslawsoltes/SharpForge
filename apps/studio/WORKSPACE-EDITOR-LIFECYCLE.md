# Workspace editor lifetime

`createWorkspaceEditorLifecycle(host)` exposes `loadRecord`, `closeRecord`, `retainRecord` and `dispose`.
The host passes its current `state`, a fresh `context()` snapshot, editor map and `saveLocal` callback.
`context()` includes stable workspace identity, revision, current disk, records and dirty paths.

The host removes a closed tab before calling `closeRecord(path)`. It calls `retainRecord(path)` before
opening or activating a view, and uses `loadRecord(path)` to admit a lazy record before creating its
editor buffer. Only the current identity, revision, membership and document version may publish after
I/O. Each new per-path intent cancels a superseded read or close. Disposal cancels every pending intent.

Clean, closed records are evicted only when independently reloadable from an attached provider and when
their exact encoded bytes match the physical baseline. Dirty, generated, read-only recovery, conflicted,
busy, unbacked or open records remain materialized. The disk retains path, size, version, optional
lastModified and lazy status; hashes remain as independent baselines. Reopening reads current provider
bytes and advances the document version. No evaluated project membership is removed by eviction.

`releaseDocumentView(path)` should dispose all closed editor views and return false if any live view
must retain the buffer. `isDocumentOpen(path)` accounts for splits and detached windows. The provided
`releaseWorkspaceEditorView({editors,docking,onReleased}, path)` handles the primary editor and both
docking content caches. Hosts with multiple view identities must supply their document service guard.

Optional `releaseDocumentCaches`, `renderDocuments` and `releaseCompilerDocuments` callbacks release
derived state after local eviction. Compiler requests carry the exact closed `{uri,version}`. The
worker's `registerDocumentLifecycleHandlers(handlers,{workspace})` validates the entire bounded request
before removing only matching source versions. Newer reopened versions and generated URIs are protected.
`syncWorkerDocuments(workspace, files)` preserves the existing full-file synchronization behavior.

This foundation does not register the actual compiler protocol method or edit the protected Studio
entry. The dependent worker/application batch wires those seams. The standalone eight-case fixture
covers cache release/current-byte reload, retained buffers, digest and admission races, exhausted
versions, atomic worker batch validation and docking cache ownership. The full session fixture also
covers evaluated membership, read-only ingestion and 5,000-file admission. Report each executed cohort
against its exact source; fixture assertions do not qualify a browser picker or native filesystem.
