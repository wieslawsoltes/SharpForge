# Git storage, references and configuration

The storage layer is independent of hosting providers, authentication and HTTP.
The same object database runs in memory, IndexedDB, an OPFS module worker, a
picked File System Access directory, or the separate Node filesystem entry point.
Objects use native Git loose-object framing and compression. Filesystem repositories
use the ordinary `objects/`, `refs/`, `logs/`, `HEAD`, `packed-refs`, `config` and
`index` paths, so native Git can inspect commits produced by SharpForge.

## Object database

```js
import { MemoryObjectDatabase, encodeTree, encodeCommit } from '@sharpforge/git';

const odb = new MemoryObjectDatabase({ algorithm: 'sha1' });
const data = new TextEncoder().encode('Hello from SharpForge\n');
const blob = await odb.write('blob', data);
const tree = await odb.write('tree', encodeTree([
  { name: 'hello.txt', mode: 0o100644, oid: blob }
]));
const identity = {
  name: 'Ada', email: 'ada@example.test', timestamp: 1700000000, timezone: '+0000'
};
const commit = await odb.write('commit', encodeCommit({
  tree, parents: [], author: identity, committer: identity, message: 'Initial commit\n'
}));
const object = await odb.read(commit);
```

`ObjectDatabase` accepts `{store, algorithm, alternates, packs, maxObjectBytes}`.
The default backend is a new isolated `MemoryStore`. Algorithms are `sha1` and
`sha256`; a repository never silently changes its object format. An alternate
must use the same format. There is no implicit filesystem or network traversal.

| Operation | Result and contract |
| --- | --- |
| `write(type, data, {signal})` | The canonical hexadecimal object ID; `data` is a `Uint8Array`. |
| `writeMany(objects, options)` | An atomic array of object IDs from an iterable of `{type,data}`. |
| `read(oid, {signal})` | `{oid,type,data,size}` with verified content address and object semantics. |
| `readHeader(oid, options)` | `{oid,type,size}` after verification. |
| `has(oid, options)` | `false` only for absence; corruption, cancellation and storage failures still throw. |
| `list({signal,includeAlternates})` | Sorted object IDs from loose storage, attached packs and optionally alternates. |
| `remove(oid, options)` / `delete(oid, options)` | Remove the local loose representation only. |
| `addAlternate(odb)` | Add a same-format explicitly supplied alternate. |
| `addPackReader(reader)` | Attach an object reader with `read`, and optionally `has`/`list`. |
| `close()` | Close the owned store. |

All object results and memory-store values are copied across the ownership boundary.
Mutating a caller's buffer cannot change an already committed object. Reads verify
the loose-object hash and framing; packed readers verify the pack/index checksums,
entry CRC and reconstructed object ID. Alternate cycles terminate, and an alternate
search is bounded to 64 database instances.

`maxObjectBytes` defaults to 64 MiB and includes the uncompressed loose-object
envelope, including its header. `writeMany` defaults to at most 100,000 entries and
256 MiB of compressed data per transaction. A thrown generator, invalid object,
quota error, exceeded bound or cancellation before commit aborts the whole batch.
Use bounded batches for large imports. Metadata reads currently verify the entire
bounded object; they do not return an unverified size from an arbitrary prefix.

## Byte-store contract

Every backend implements asynchronous `get(key, {signal})`,
`set(key, Uint8Array, {signal})`, `delete(key, {signal})`,
`list(prefix, {signal})`, `transaction(callback, {signal})` and `close()`.
An absent value is `undefined`; an empty byte array is a present value.
Paths must be normalized relative paths: absolute paths, traversal components,
backslashes, empty components and control characters are rejected before I/O.

A transaction callback receives a byte store with `get`, `set`, `delete` and
`list`. Do not retain that transaction object after its callback completes.
The memory backend commits a write set in time proportional to the changed keys;
it does not clone or rescan the entire object database per write. Its optional
`maxBytes` quota includes all committed byte values.

`installPack({id,pack,index}, options)` stores the pack and index in one
transaction. `readPack(id)` returns `{id,pack,index}`. `listPacks()` returns IDs,
and `removePack(id)` removes both files. IDs are full hexadecimal SHA-1 or SHA-256
pack checksums. The storage primitive does not substitute for pack validation:
untrusted packs must pass the pack reader before callers make their refs visible.

## IndexedDB

```js
import { createBrowserObjectDatabase } from '@sharpforge/git';

const { odb, store, backend, capabilities } = await createBrowserObjectDatabase({
  repositoryId: 'workspace/project-one',
  backend: 'indexeddb'
});
```

The returned descriptor is `{odb,store,backend,capabilities}`. The store partitions
records by repository ID inside the configurable `sharpforge-git` database. Each
logical value consists of a manifest and chunks in the same native IndexedDB
transaction. The default chunk size is 1 MiB and the maximum logical value is
512 MiB. Empty values, overwrites and deletes have the same semantics as memory.

Transactions remain alive while an asynchronous callback is awaiting codec work.
Their promise resolves only after IndexedDB reports transaction completion.
`QuotaExceededError` becomes a stable `GitError` with code `Quota`. Aborting a
pack installation rolls back its manifest, every chunk and its index together;
an incomplete pack is never exposed by the API. A version change from another tab
closes the database, and a blocked schema upgrade is reported as `Conflict`.

`IndexedDBObjectDatabase` is a convenience `ObjectDatabase` subclass around an
`IndexedDBStore`. Passing a store explicitly lets refs, config and a working tree
share the same repository identity and transactional boundary.

## OPFS

The default `createBrowserObjectDatabase` preference is `opfs`. It starts a static
module worker, probes real synchronous access handles and uses a SHA-256-derived
directory name for the repository ID. Synchronous filesystem I/O occurs only in
that worker. Web Locks serialize operations across workers and browser tabs.

The worker stages transaction contents and their previous versions before writing
a durable journal decision. Readers recover an interrupted journal before exposing
repository data. Failed publication rolls back every prior file. Once the durable
commit decision is written, completing or recovering that transaction takes
precedence over a late cancellation. The worker closes each access handle in a
`finally` block; `close()` terminates the worker and rejects outstanding requests.

Unsupported OPFS, module-worker, sync-handle or Web Locks capabilities cause the
factory to select IndexedDB. The returned capability record reports the actual
backend, `fallbackFrom: 'opfs'`, and `fallbackReason`; consumers should display
that reported backend. Quota or corruption errors are surfaced rather than
silently opening a different empty repository.

`OPFSObjectDatabase` can be constructed directly when fallback is not desired;
await its `ready()` method before reporting the backend as available. A directly
constructed `OPFSStore` exposes its startup promise as `store.ready`.

## References and reflogs

```js
import { RefDatabase } from '@sharpforge/git';

const refs = new RefDatabase({ store, algorithm: odb.algorithm });
await refs.setSymbolic('HEAD', 'refs/heads/main', { expected: null });
await refs.update('HEAD', commit, {
  expected: null,
  identity,
  message: 'commit: Initial commit'
});
```

`resolve(name)` returns `{ref,oid}` after following symbolic refs, with `oid:null`
for an unborn target. `read(name)` returns the resolved ID or `null`.
`read(name,{deref:false})` returns the literal symbolic target name, direct ID, or
`null`. Loose refs override packed refs. Cycles and depth overruns are errors.

`update(name,oid,{expected,deref,identity,message,signal})` defaults to following
symbolic refs. Supplying `expected:null` requires that the ref be absent; omitting
`expected` requests an unconditional update. With `deref:false`, `expected`
compares against the raw symbolic target or direct ID, but the reflog still uses
the resolved old/new object IDs. This supports detached-HEAD checkout correctly.

`setSymbolic(name,target,options)` compares an optional expected raw target/ID,
checks for cycles before commit, and records the old and new resolved IDs in the
reflog. `delete(name,options)` is an update to `null` and also removes any packed
fallback for that target. `transaction([{name,oid,expected,...}],options)` checks
all expectations and namespace conflicts before publishing any ref or log.

Reference names follow `git check-ref-format`, including `.lock`, `..`, `@{`,
control-character, leading-dot and separator restrictions. Standalone validation
offers `allowOneLevel`, `refspecPattern`, and `branch` options. The database accepts
full `refs/...` names and explicit uppercase pseudorefs such as `HEAD`. It rejects
file/directory collisions such as simultaneously creating `refs/heads/topic` and
`refs/heads/topic/subtopic`.

`list(prefix='refs/')` returns sorted `{name,oid,symbolic?,peeled?}` records.
`pack({prune:true})` writes native `packed-refs` and prunes corresponding loose
direct refs. Annotated-tag peeled records from existing packed refs are preserved
unless overridden by a different loose value. `reflog(name='HEAD')` returns parsed
native log records. Timestamp fields are Unix seconds, and timezone strings are
`+HHMM`/`-HHMM`. A supplied `clock` makes tests deterministic. Reflogs have a
configurable 16 MiB bound; exceeding it fails without modifying the ref.

## Lossless configuration

`ConfigDocument(source)` parses a syntax document while retaining original
comments, spelling, ordering, line endings and unmodified physical records.
`toString()` is byte-for-byte identical for an unedited UTF-8 config. Section and
variable names are case-insensitive; modern quoted subsection names retain case.
The parser supports quoted escapes, continuations, valueless booleans, repeated
values and Git's deprecated dotted subsection headers.

Keys use `section.name` or `section.subsection.name`. The first and final dots
separate section and variable, so subsection names may themselves contain dots.
`get` returns the final value, `getAll` returns all values in source order, and
`getBoolean`/`getInteger` perform checked conversion, including `k`/`m`/`g` integer
suffixes. `set(key,value,{append:true})` appends a multivar. Ordinary `set` replaces
only the final matching record while retaining its inline comment and indentation.
`unset` removes matching entries without rewriting neighboring comments.

`include.path` and `includeIf.*.path` remain in the syntax document but are never
opened. Each produces a `GitConfigIncludeDisabled` warning. External includes,
hooks, credential commands or remote configuration cannot implicitly grant access
to files or executable code.

`GitConfig({store,path:'config'})` wraps the document. Call `load()`, edit through
its synchronous methods, then `save()`. Saving compares the current bytes with the
loaded version and reports `Conflict` on a stale edit; `force:true` is an explicit
caller choice. It never silently overwrites another writer's change.

## Native repository adapters

```js
// Browser: directory is an explicitly granted FileSystemDirectoryHandle.
import { openLocalRepository, GitRepository } from '@sharpforge/git';
const descriptor = await openLocalRepository({ directory });
const repository = new GitRepository(descriptor);
await repository.loadIndex();
const changes = await repository.status();
```

`initLocalRepository` and `openLocalRepository` return
`{odb,refs,config,store,worktree,directory,gitDirectory,algorithm,capabilities}`.
They open `.git` only through the Git-specific path; ordinary workspace enumeration
continues excluding it. Existing `.pack`/`.idx` pairs are validated and attached
when a repository opens. `bare:true` treats the supplied directory itself as the
metadata directory and omits the working tree.

File System Access has no portable executable-bit, symlink-creation or native Git
lockfile API. The working-tree adapter reports unsupported modes explicitly. The
metadata store uses Web Locks and a recovery journal for cooperating browser
clients; capability `nativeGitLocks:false` means an external command-line writer
cannot participate in that browser lock. Callers should coordinate simultaneous
external writes. This is separate from the Node adapter's native lock behavior.

```js
// Node-only entry: no node:* modules are imported by the browser package entry.
import { openNodeRepository, initNodeRepository } from '@sharpforge/git/node';
const descriptor = await openNodeRepository({ directory: '/work/project' });
```

`NodeFileStore` holds native `<path>.lock` files while preparing changes and checks
the transaction's read set again before publication. An existing Git lock yields
`Conflict` and is never deleted by SharpForge. Native working-tree support includes
executable files and literal symlink blobs, while rejecting path traversal,
`.git` writes and symlinked parent traversal. Per-process transaction lockfiles
left after an abrupt process termination are reported as conflicts; they are not
automatically removed while an external writer may still be active.

Prefix-changing ref renames, such as `feature` to `feature/sub` and the reverse,
stage both the reference and reflog namespace changes before publication. The
Node adapter records native lock inode ownership in a durable preparation journal,
then records the original and replacement bytes before removing any old file.
Directory replacement removes only empty directories and the transaction's own
locks; an unrelated file or another writer's lock produces `Conflict`.

A publication failure restores every changed original file, including symbolic
HEAD and reflogs. After abrupt process termination, the stale process lock still
requires explicit owner resolution. Once that lock is safely resolved, the next
Node store access recovers the recorded transaction before exposing metadata. A
preparation-only journal releases only its own locks, an incomplete publication
restores its originals, and a committed journal needs only cleanup. Recovery
rechecks values after acquiring formerly obstructed path locks and retains the
journal if a conflicting external update prevents restoration. Directory flushes
are used where the platform supports them; worker-termination fixtures qualify
process-crash recovery, not hardware power-loss behavior.

Linked-worktree `.git` indirection, ungranted filesystem alternates and unsupported
repository extensions produce `Unsupported` diagnostics. Callers can explicitly
provide already authorized alternate object databases. No path in an untrusted
repository expands the caller's filesystem grant automatically.

## Acceptance fixtures

The focused Node suites are `tests/a25-storage-memory.test.js`,
`tests/a25-storage-refs.test.js`, `tests/a25-storage-config.test.js` and
`tests/a25-storage-filesystem.test.js`, with recovery-specific fault injection in
`tests/a25-storage-journal.test.js`. Native tests record the installed Git
version and compare check-ref-format, config, object hashes, packed clone status,
lock behavior and visibility of SharpForge commits in native `git log`.

`tests/a25-storage-browser.html` exposes a browser acceptance API for the epic-level
runner. Its IndexedDB persistence phases write 50,000 distinct objects, reload,
then rehash all 50,000. Quota tests inject `QuotaExceededError` into a real native
IndexedDB transaction after pack chunks have been written and verify rollback
after reopening. The same object/ref/config/cancellation/transaction cases run
against memory, IndexedDB and the actual OPFS sync worker. A separate fixture
exercises File System Access APIs with an OPFS-provided directory handle; it does
not claim that a browser test exercised an OS directory picker.

After the complete scope is ready, CI runs the repository's pinned Python
Playwright dependency through `tests/a25_storage_browser.py`:

```sh
python tests/a25_storage_browser.py --output /absolute/evidence/storage-browser.json
```

With no arguments, it writes to the existing `SHARPFORGE_RESULTS_DIR` convention,
so area manifests can invoke it directly. No npm dependency is required by CI.
The optional Node driver can use an already installed development Playwright:

```sh
node scripts/a25-storage-browser-check.mjs --output /absolute/evidence/storage-browser.json
```

The driver serves actual source modules with the build's package-entry alias
rewrite and the production browser CSP. It writes machine-readable evidence with
the implementation commit, actual Chromium/Playwright versions, observed worker
URLs, per-case results and an initial readiness screenshot. It never substitutes
in-memory storage for browser APIs. A missing Chromium executable or a failed
backend is a failure, not a passed or silently skipped case.

`CHROMIUM_EXECUTABLE` selects an installed binary for either driver. The Node
driver additionally accepts `--chromium-executable`.
`--playwright-module` accepts an explicit Playwright module path; the driver also
recognizes the primary runtime's installed test dependency. For an independently
authorized browser endpoint, `--cdp-endpoint` or
`SHARPFORGE_BROWSER_CDP_ENDPOINT` creates a fresh isolated context; it never probes
for sessions or uses existing pages. The runner's fixture HTTP origin must be
reachable from that browser. Endpoint values are omitted from evidence.

`--cases` selects named cases for a focused rerun after a diagnosed failure;
`--count` can reduce the persistence fixture during development. Evidence reports
full storage scope only when every case was selected and at least 50,000 objects
passed persistence validation. `--timeout-ms` bounds each case independently.
