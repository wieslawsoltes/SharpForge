# Atomic source and resource rename in Studio

`applyExplorerResourceTransaction(plan, {documents, explorer, signal})` is the
Studio host contribution for editor workspace edits that also rename source
files. It consumes an editor plan with `label`, `changes` and `resources`:

```js
{
  label: 'Rename Alpha',
  changes: [{
    uri: 'App/Alpha.cs', version: 3, before: 'class Alpha {}',
    text: 'class Beta {}', edits: [{start: 6, end: 11, text: 'Beta'}]
  }],
  resources: [{
    kind: 'rename', oldUri: 'App/Alpha.cs', newUri: 'App/Beta.cs',
    version: 3, before: 'class Alpha {}'
  }]
}
```

All positions are UTF-16 offsets. Text changes refer to the old URI. Every
changed or renamed source must be an owned, writable EditorModel with the exact
expected version and content. The adapter copies the supported plan fields
before its first await. It returns a promise of
`{applied: true, changes, resources}` only after the host commits successfully.
The editor adapter delegates the whole plan to this contribution; it must not
apply text changes to live models first.

## Preparation and ownership

The adapter captures the workspace identity, source owners, immutable source
snapshots, saved baselines and file metadata before asynchronous validation.
It compares source content in 64 KiB slices and yields after each MiB, retaining
the snapshot's lazy full-text representation. An optional AbortSignal can cancel
preparation. Missing, stale or read-only documents, malformed spans, conflicting
paths and a declared final text that disagrees with the edits all fail before
ownership transfers.

Text edits are applied to detached models created from the captured immutable
source. All resource moves and supported project XML path rewrites are added to
one Explorer operation array. URI rebasing, shared source snapshots, unsaved
baselines and file-operation undo reuse the existing Explorer transaction.
Original live source models are not edited while preparing a resource change.
Unchanged source models retain their owner and editor history. Affected models
are replaced together; undo restores their captured source and dirty baseline
through Explorer's file-operation history.

The adapter releases its staged models on failure and retains every model that
DocumentService adopted. A postcommit subscriber failure remains a
`DOCUMENT_COMMITTED` error with `committed: true`: the workspace changes and their
file-operation undo remain valid.

## Host commit contract

`ExplorerCommands.perform(operations, mappings, {validate})` forwards the optional
guard into the prepared host payload. Explorer invokes it immediately before
calling `host.commit`. A host that awaits its own validation must invoke
`prepared.validate?.()` again immediately before `documents.replace`.
The guard checks source owner/snapshot/version identity, saved state, affected
read-only locks, workspace identity, files and folders. It does not overwrite a
newer edit, successful save, workspace switch or new document.

The host passes the prepared `documentStates` Map to `documents.replace` with
`preserveDirty: true`. It supplies `commitMetadata`, a synchronous callback that
publishes the staged project/file metadata after document ownership commits and
before document reset subscribers run. This callback does not await, perform
fallible preflight, or apply text edits. The host completes its normal postcommit
handling even when a subscriber fails.

Root integration supplies this function through the editor model workspace's
`applyResourceTransaction` option. The language provider and editor preview own
the versioned workspace-edit plan and confirmation UI; the Explorer contribution
owns its source/file transaction. Neither layer patches the other layer's methods.

## Supported bounds and explicit limits

This contribution supports C# file renames in the browser workspace. Native
disk resource changes return `SFEX_RESOURCE_UNSUPPORTED`: the existing native
mutation protocol has partial-write/undo semantics, not an atomic resource
commit. Create/delete operations are also outside this resource contribution.

A plan supports at most 128 renames, 100,000 text edits, and the existing Studio
document/source limits. Destinations must be distinct, portable relative paths
and unoccupied under Explorer's case-folded collision rules. Rename chains into
an existing source path and case-only destination collisions are rejected.

Literal paths in `.csproj`, `.slnx`, `.props` and `.targets` use the existing
`rewriteProjectPath` API. It preserves comments and leaves property, wildcard and
other evaluated expressions untouched. XML retains the project parser's own
bounded size and nesting rules. Project rewriting costs the supported mapping
count times XML length and yields between mapping batches; no speedup or native
filesystem behavior is claimed.

## Qualification

`tests/a19-explorer-resource-transaction.test.js` exercises the actual
DocumentService, EditorModel, project XML rewrite and Explorer history adapters.
It covers combined text/file/XML changes, matching metadata observed by reset
subscribers, dirty undo, independent multiple renames, unchanged model retention,
bad plans, cancellation, async precommit races and postcommit ownership.
It also covers source comparisons larger than one MiB without setting the
snapshot's full-text materialization flag. The complete-scope command was
`node scripts/limited.js node --test --test-concurrency=1 tests/a19-explorer-resource-transaction.test.js tests/a19-explorer-snapshots.test.js tests/a19-explorer-source-plans.test.js tests/a19-document-operation-state.test.js tests/a19-prepared-documents.test.js tests/a19-document-snapshot-save.test.js tests/a19-documents-state.test.js tests/release08-commands.test.js`.
On Node 24.19.0 it ran 73 tests in 2.3507 seconds: 72 passed, including all nine new
resource cases, and one existing save test found that the host API dependency
delayed the legacy synchronous snapshot capture. The DocumentService owner fixed
that timing in `646b033d` (applied here as `4c79d3eb`), preserving synchronous
provider acquisition and awaiting only genuine asynchronous preparation. The
entire affected file then passed 6/6 with no skips in 0.3007 seconds through
`node scripts/limited.js node --test --test-concurrency=1 tests/a19-document-snapshot-save.test.js`.
All 73 distinct cases have therefore passed across the initial run and affected
rerun; this is not a claim of one uninterrupted 73-test pass. No assertion was
weakened. Actual browser rename UI and native filesystem qualification remain
separate.
