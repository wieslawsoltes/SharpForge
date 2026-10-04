# Explicit large source file I/O

`readBrowserFiles(files, options)` and `readDirectory(handle, options)` retain conservative defaults:

| Option | Default |
| --- | ---: |
| `maxFiles` | 20,000 |
| `maxFileBytes` | 2,000,000 |
| `maxAssemblyBytes` | 64 MiB |
| `maxTotalBytes` | 128 MiB |

Source and save limits count encoded bytes, including a BOM. UTF-16 source consumes two bytes per code unit;
UTF-8 counts complete code points. The previous character-count check is now consistent with byte limits
for non-ASCII text. Binary assets, including undecodable `.cs` assets, retain the separate assembly/total limits.

Studio can opt into its large-file policy at the I/O boundary:

```js
const limits = {
  maxFileBytes: 256 * 1024 * 1024,
  maxAssemblyBytes: 256 * 1024 * 1024,
  maxTotalBytes: 320 * 1024 * 1024
};
const disk = await readDirectory(directoryHandle, limits);
await disk.save([{path: 'Program.cs', text: changedText}]);
```

`readDirectory` passes the validated immutable limits into its returned `DiskWorkspace`.
`readBrowserFiles` attaches the same non-enumerable limits to its record array; constructing
`new DiskWorkspace(records)` inherits them. An explicit constructor override is the sixth argument:
`new DiskWorkspace(records, handles, name, folders, skipped, limits)`.

Save preflights every file and the resulting workspace total before opening any writable stream.
It preserves original encodings, resolves permissions for all writes, and checks disk text again after
permission prompts. External changes still fail without overwriting source. Concurrent saves are
serialized; optional `expectedVersion` equals `disk.getVersion(path)` and rejects queued stale saves.
This version is a disk-session revision counter, independent of language-service document versions.

Successful save returns `{written, atomic: false}`. Multi-file filesystem writes cannot be atomic;
a failed write reports paths already written and advances the baseline only for successful files.
No native permission-dialog or physical filesystem guarantee is inferred from test doubles.

## Optional prepared source contribution

`readBrowserFiles` and `readDirectory` accept `readSource(file, {path, signal,
limits, encoding})`. The callback is used only for `.cs` source files, after byte preflight.
Other assets use the existing archive decoder. Omitting the callback preserves
the default eager reader, including binary `.cs` assets. The source reader and
AbortSignal are kept separate from the immutable numeric limit object.

Studio contributes `readStudioSource`, backed by the editor package's public
`readEditorSource` decoder. A prepared record has a frozen `source` snapshot and
a matching `model`: URI, version, length and snapshot identity must agree.
`byteLength` records the original file size. Source and model fields are
nonenumerable; `text` stays a lazy export/compatibility property. The project
system does not import the editor package or construct editor models itself.

FileList and directory reads are all-or-nothing preparations. A cancellation,
decoder error, malformed contribution, duplicate path or failed traversal
disposes models created by that read and returns no partial workspace. The
caller owns successful preparations until DocumentService accepts the complete
batch. Model identity, project membership and compiler source selection are
available without evaluating source text. Actual compilation/export may read
the lazy text property explicitly.

`DiskWorkspace` retains immutable snapshots as baselines and the reader callback
for conflict checks. `save([{path, source, expectedVersion}])` captures a frozen
snapshot immediately; newer model edits cannot change the pending save. It
counts encoded bytes and writes bounded chunks, including a BOM exactly once.
Surrogate pairs remain intact across UTF-8 chunk boundaries. Conflict checks
before and after permissions read the disk through the same bounded decoder and
compare snapshot windows. Legacy `{path, text}` saves remain supported.
Known-baseline reads carry the record's `encoding` into the contribution, and
Studio forwards it to the strict source decoder. A BOM-free UTF-16LE/BE source
therefore retains its encoding across Save As and later Save operations. A
conflicting BOM or unreadable changed source still rejects the save.

`disk.save(changes, {signal})` checks cancellation before a queued operation starts, during encoded
preflight/baseline reads, after permission prompts, after stream acquisition
and between writes. Before `close()` starts, cancellation aborts the acquired
stream and leaves that file's baseline/version unchanged. Once close has
started, its completion determines that file's committed result. Later files
are not started after cancellation; an error retains exact `written` paths for
those already committed. Rebased workspaces share the same serialized queue.

## Accepting an observed external version

`disk.acceptBaseline(path, observed, {expectedVersion, expectedHandle, signal,
check, commit})` joins that same save queue. `observed` contains immutable
`source` or `text`, `encoding`, Boolean `bom`, and exact `byteLength`. The
existing path, handle identity, and disk revision must still match. Encoded
size and total workspace budgets are validated, then the actual granted file
is reread and compared with the observation. Source contributions receive an
optional `maxCharacters` bound while verifying an observation; Studio honors it
in its cooperative decoder. Ordinary readers retain their existing defaults.

After asynchronous validation, optional `commit(accept)` must invoke `accept`
exactly once, synchronously. This lets a host stage document text/clean metadata,
accept the disk baseline before notifications, and roll back if precommit
validation fails. Without a callback, the validated baseline is accepted
directly. `check()` may throw or return false to reject changed host ownership
before acceptance. Callbacks must not perform asynchronous work.

Acceptance replaces the stored descriptor record, updates its source,
encoding/BOM and byte size, increments the disk revision once, and returns
`{path, version, byteLength}`. The cache retains immutable content without a
borrowed editor model; it neither writes the physical file nor adopts or disposes
a model. Precommit rejection leaves disk state unchanged; an error after `accept`
has `committed:true`, so notification failures cannot be mistaken for a rollback.
`SFPROJECT_DISK_OBSERVATION_STALE` identifies changed target/revision/content.
The workbench observer uses this API for external reload so its next actual
save passes the existing conflict checks without overwriting a newer disk edit.

## URI rebasing and ownership

`prefixWorkspace(records, folders, prefix, {rebaseSource})` and
`importWorkspaceRecords(records, folders, {rebaseSource})` copy property
descriptors instead of reading their values. Path changes to prepared source
require the synchronous contribution; Studio supplies public
`rebaseEditorSource(record, newUri)`. It creates a new clean model from the
persistent snapshot, while the original model stays caller-owned. A failed
rebase disposes only new models created during that rebase. Missing providers
produce `SFPROJECT_SOURCE_REBASE`, rather than accepting mismatched URIs.

Manifest extraction exposes a nonenumerable `pathMap` from original to relative
paths. `disk.rebasePaths(pathMap, extracted.records, extracted.folders)` returns
a staged disk workspace with the same granted handles, snapshots, byte sizes and
disk revisions. It retains metadata files excluded from the document list, and
shares the save queue with the original workspace. Rejected adoption leaves the
original workspace usable. The workbench owns disposal after adoption; a
`DOCUMENT_COMMITTED` error still means its models have transferred ownership.
If a prepared record's current source differs from its original source,
rebasing preserves a separately rebased `originalSource`. Its recorded
`byteLength` still belongs to that old root. Missing byte-baseline identity stays
unknown, allowing the workbench's current-source budget to remain conservative.

## Shared streaming output

`encodedWorkspaceSourceChunks(source, options)` is an async iterator of encoded
byte chunks. `writeWorkspaceSource(stream, source, options)` writes those chunks
without closing or aborting the stream. Options are `path`, `encoding`, `bom`,
`signal` and `maxBytes` (default 256 MiB). UTF-8, UTF-16LE and UTF-16BE are supported;
byte limits include the BOM. Encoding yields between chunks and rejects aborted
or oversized output. The caller closes on success or aborts on error. Save As can
reuse this exact encoder after obtaining its handle, and an explicit download
can consume the same iterator into Blob parts.
`isSourceSnapshot(value)` exposes the same frozen snapshot capability check to
application save handlers; mutable models and strings are not snapshot objects.

The strict source round trip rejects unpaired UTF-16 surrogates, NUL characters,
and a leading U+FEFF without a separately requested BOM. These cases would be
replaced, classified as binary, or consumed as a BOM by a later source read.
`SFPROJECT_SOURCE_ENCODING_LOSS` includes `path`, UTF-16 `start`, `length` and
`severity:'error'`. Disk preflight rejects these before opening a stream. Direct
stream/download consumers receive the same diagnostic; an acquired stream must
be aborted and never closed. Valid surrogate pairs and literal U+FEFF following
an explicit BOM remain lossless.

Focused regression command:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a20-source-loader.test.js tests/a20-prepared-source-workspace.test.js \
  tests/a20-prepared-source-paths.test.js tests/a20-large-file-disk.test.js \
  tests/project-system.test.js tests/workspace-io.test.js tests/release04.test.js
```

The large-file fixtures exercise sources over 2 MB, inherited opt-in limits, UTF-16 encoding/BOM limits,
aggregate preflight, queued versions, external changes and permission-time changes. Existing disk/project
and workspace I/O regressions remain in the same consolidated validation run.
