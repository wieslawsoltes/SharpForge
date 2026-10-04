# Local Git workflows

`GitRepository` composes the object database, reference database, byte-oriented worktree and configuration store. It does not start a shell, execute repository hooks, invoke configured filters, run aliases or load code from a repository. Network transports and provider accounts are composed by the Git service above this layer.

```js
import { GitRepository, MemoryWorktree } from '@sharpforge/git';

const repo = new GitRepository({ worktree: new MemoryWorktree() });
await repo.init({ branch: 'main' });
repo.config.set('user.name', 'Example Developer');
repo.config.set('user.email', 'developer@example.test');
await repo.config.save();

await repo.worktree.write('src/example.js', 'export const answer = 42;\n');
await repo.add(['src']);
const commit = await repo.commit({ message: 'Add example' });
console.log(commit.oid);
console.log(await repo.status());
```

## Storage and worktrees

Pass `{ odb, refs, config, store, worktree, algorithm }` from a repository-opening adapter, then call `init()` to load its existing index and rules. `init()` does not replace an existing HEAD or overwrite an existing Git configuration. SHA-1 is the default; SHA-256 repositories require `algorithm: 'sha256'` throughout the object, index and reference layers.

The worktree contract consists of asynchronous `read(path, options)`, `write(path, bytes, { mode, signal })`, `remove(path, options)` and `list(options)` methods. A read returns `{ data: Uint8Array, mode, stat }` or `null`. `MemoryWorktree` stores all Git modes, and `KeyValueWorktree` persists exact bytes and modes in an explicitly supplied store. `FileSystemWorktree` accepts a File System Access or OPFS directory handle. Its portable browser implementation rejects executable and symlink modes because the browser API cannot faithfully represent them. `DiskWorkspaceWorktree` accepts the same root handle through `{ directory }`; it leaves the editor's open-document collection untouched. A DiskWorkspace instance created without a retained directory handle needs that handle supplied explicitly. The Node adapter supports executable files and symlinks.

Files remain in the worktree regardless of whether an editor has opened them. Checkout therefore has no 100-document cap.
An authoritative `stat.revision` enables reuse of previously cleaned content and object ids. The Node adapter compares full
device/inode identity, size, mode, nanosecond modification time and change time, and refuses reuse inside ambiguous timestamp
windows. Adapters without either contract are rehashed for correctness. All worktree paths undergo portable path validation.
Absolute paths, traversal, metadata aliases, device names, case collisions and symlink escapes fail before checkout writes start.

Adapters may supply `scan({ signal, maxEntries, excludedPaths })`, returning a `Map` of current paths to `{ mode, stat }` without
copying content. Status shares that snapshot with rule discovery; it does not cache the list of existing files. The optional
`readMany(paths, options)` method yields `[path, file]` pairs through an async iterator. The Node implementation reads files up
to 64 KiB in bounded batches that yield at roughly 8 ms intervals, and keeps larger reads asynchronous. Both methods retain
path, mode, file-size and cancellation checks. Missing paths invalidate their prior hash entries.
The Node adapter retains validated names and immutable metadata records, but checks each current entry with `lstat` before
reusing any record. `clearScanCache()` discards the derived records and private scan proofs; the cold fixture invokes it.
Only snapshots created by that adapter instance authorize batched descriptor reads. A batch holds at most 16 files and
1 MiB, verifies directory identities before and after reading, and checks each opened file against its scanned inode and
full stat before accessing bytes and again afterward. Platforms without `O_NOFOLLOW`, symlinks, large files and unrecognized
snapshots use the original checked-path reader. Snapshot maps supplied by callers cannot manufacture those private proofs.

`replaceObjectDatabase(odb)` installs an object wrapper with the same object format, updates the graph reader and clears derived graph, status, history and view caches. The replacement must expose `read`, `write` and `algorithm`. The old database remains owned by its caller. Disposing the repository disposes the current wrapper when it provides `dispose()`, while the opening adapter remains responsible for closing its underlying store. Checkout calls the wrapper's optional `prefetch(oids, options)` once for distinct changed file objects after path, dirty-buffer and overwrite checks succeed.

Indexed submodules are opaque worktree roots. Parent status, staging and rule discovery exclude their descendants. A locally composed child reader can be installed with `setSubmoduleAdapter({ async state(path, options) { ... } })`; constructor option `submoduleAdapter` accepts the same object. It returns `{ initialized, oid, modified, untracked }` and receives the current `indexOid` and cancellation signal. State inspection must not initialize a repository or access the network. Unknown or uninitialized child state preserves the parent index pin; an initialized child with no commit cannot be staged. Parent staging records only the child's HEAD object id, without importing child objects into the parent database. Parent branch switches preserve the child's working files when its pin changes or is removed.

## Index and staging

`repo.index` is a `GitIndex`. Its `entries` getter returns byte-sorted records containing `path`, `oid`, `mode`, `stage`, `stat`, `assumeValid`, `intentToAdd`, `skipWorktree` and preserved extended flags. Access one stage through `index.get(path, stage)`, replace an entry with `index.set(entry)`, and remove all stages with `index.remove(path)`. `saveIndex()` persists caller edits; `loadIndex()` reloads external changes. Writes compare the stored index against the last loaded bytes so another instance cannot silently overwrite a concurrent update.

`decodeIndex` and `encodeIndex` support DIRC versions 2, 3 and 4, authenticate the index trailer, preserve optional extension payloads and encode v4 prefix compression. A version-2 index is promoted to version 3 when extended flags are needed. TREE and REUC have separate structured codecs. Changing index content invalidates derived cache extensions; staging a resolved conflict records the former stages in REUC. Split-index replacement entries and sparse-directory entries require expansion before ordinary editing; they are rejected explicitly instead of being mistaken for regular files.

| Operation | Contract |
| --- | --- |
| `add(paths, options)` | Stage paths and tracked removals; supports `update`, `intentToAdd`, `force` and `sparse`. |
| `remove(paths, options)` | Remove tracked entries; `cached` preserves worktree files, while `force` explicitly permits discarding staged or working changes. |
| `move(source, destination, options)` | Rename a tracked file or directory while preserving distinct staged and working versions. |
| `unstage(paths, { source })` | Replace matching index entries with entries from the selected tree; defaults to HEAD. |
| `stagePatch(path, patch, options)` | Apply exact-context unified hunks to the index blob; `reverse` unstages. |
| `stagePatch(path, selection, options)` | Select changed operations using `{ before, after, selectedLines }`; line identifiers are operation indexes or `old:n`/`new:n`. |

Ignore matching supports nested `.gitignore` files, explicit global excludes, `.git/info/exclude`, negation, anchored patterns, directory-only patterns, double stars, escaped characters and character classes. An excluded parent directory prevents a child negation from re-including its contents. Pattern matching uses a bounded automaton rather than unrestricted regular-expression backtracking. Pathspecs support `glob`, `literal`, `icase`, `top` and `exclude` magic.

Attributes preserve set, unset, unspecified and string values. Text, EOL, binary, diff, merge, filter and export-ignore data remain available to the owning features. EOL processing preserves arbitrary binary bytes, applies `core.autocrlf` and enforces `core.safecrlf`. Executable filter commands in Git configuration remain inert. A host can supply a trusted filter object through `GitExecutionPolicy`, or inject an LFS client whose `clean()` method returns pointer bytes.

## Commits and signatures

`commit({ message, author, committer, amend, allowEmpty, allowEmptyMessage, cleanup, sign })` writes immutable trees and a commit before advancing HEAD with a compare-and-swap update. Identities are strings in Git's identity format or `{ name, email, timestamp, timezone }` objects. Timestamps are Unix seconds and timezones use `+HHMM` or `-HHMM`. Supplying fixed identities produces reproducible commit ids. Message cleanup supports `strip`, `whitespace`, `verbatim` and `scissors`. Amend preserves the previous author unless `resetAuthor` is set.

For SSH signing, pass `sign: { privateKey, publicKey }` with explicitly supplied WebCrypto Ed25519 keys. The implementation emits the SSHSIG container used by Git and inserts the signature in the `gpgsig` header. `verifySsh` separates cryptographic validity from trust in an explicitly supplied allowed-key set. OpenPGP signing requires a registered provider; unsupported signing never silently falls back to an unsigned commit.

```js
const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
await repo.commit({ message: 'Signed change', sign: keys });
```

## Status, diff and revisions

`status()` returns records with `path`, `oldPath`, `indexStatus`, `worktreeStatus`, `code`, `kind`, `staged`, modes and object ids. Unmerged records contain the three conflict stages. Gitlink records include the porcelain `S<c><m><u>` submodule flags. `formatPorcelainV2` formats records with newline or NUL delimiters and Git path quoting. External persisted index changes are reloaded before status; EOL, attribute and configuration changes invalidate previously cleaned stat-cache content. Exact renames are indexed by object id; similarity matching has an explicit candidate-comparison budget.

One flattened immutable tree is retained by its resolved object id and object-database identity. Returned maps and entries are
isolated from the cache, and every read still resolves current refs and enforces the requested entry bound. Replacement of the
object database and repository disposal clear it. The status performance fixture clears this tree cache as well as the hash
and graph caches before each cold sample. Its team-introduced engineering budgets are 500 ms cold and 50 ms warm for both
tested backends; these numeric limits are not Project 19 issue acceptance criteria.
Status resolves the actual HEAD directly; general revision parsing retains its separate ambiguity checks. Within a single
content scan, up to 256 small blob hashes are reused under a 1 MiB byte budget. A sampled key chooses one candidate, and full
byte equality is required before any reuse. Misses use the normal collision-detecting object hash implementation. Changed
records are sorted before rename pairing, independently of the adapter's path order.
Status uses internal map views and frozen working records to avoid rebuilding unchanged entries. Public tree reads still
return isolated mutable records. Index views observe current entry flags, and the compatibility path/stage map updates its
direct stage-zero lookup on set, delete and clear.

`diff({ from, to, staged, pathspec, renames, copies, patch })` covers commit-to-commit, HEAD-to-index and index-to-worktree comparisons. With `patch: true`, each record adds unified patch text and decoded before/after text for nonbinary content. The line engine provides Myers/minimal and histogram algorithms. Its worst-case work is bounded; a caller can raise `maxWork` when intentionally processing a difficult diff. Binary files produce a binary marker instead of an invalid text patch.

`revParse()` resolves full and abbreviated ids, ref names, HEAD and `@`, numbered reflogs, `~n`, `^n`, typed peeling, upstream/push tracking refs, tree paths and index stages. Scalar results are object ids. Ranges return `{ include, exclude, symmetric }`, which can be passed to graph walks. `A..B`, `A...B`, `A^@`, `A^!`, `A^-n` and explicit exclusions are supported. Date-based reflog selectors require a separate date parser and return an unsupported diagnostic. Filenames in this portable facade must be UTF-8.

`CommitGraph` supplies bounded reachability, all best merge bases, ancestry checks, generation-assisted traversal and topological/date ordering. `ensureGenerations(tips)` computes missing generations with an iterative parent walk and rejects cycles. Merge-base painting follows decreasing generation numbers, retains every best criss-cross ancestor and stops when only redundant ancestors remain. Populated generation caches therefore avoid reading the older common history on subsequent queries. History, blame and lane layout are separate consumers of those contracts.

Graph traversals and revision-parent expressions reload the repository's persisted `shallow` file at their public entry points. Direct `fetchRemote` callers therefore observe new boundaries on their next log, ancestor or revision query, including when shortening leaves older objects on disk. Each traversal uses a fixed boundary/generation-cache snapshot. A boundary change replaces the generation cache and invalidates derived history and view caches; `repo.refreshShallow(options)` exposes the same update for eager service refresh. Traversal records represent a shallow commit with `parents: []` and `shallow: true`. `repo.readCommit()` and the object database retain the canonical parent headers and original bytes. Path history, blame, historical comparisons and replay do not follow parents beyond a shallow boundary, and a Promisor wrapper is not asked to hydrate those parents.

## Checkout, branches and tags

`checkout(revision, { detach, force, dirtyPaths })` computes a complete update plan before changing files. It protects staged changes, modified files, untracked path collisions and unsaved editor buffers. The host can pass `dirtyPaths` through a worker boundary or inject `dirtyBuffers(path)` as an asynchronous callback. Ordinary branch switches retain unrelated local changes. Filesystem failures restore a persisted-content snapshot; rollback failures report the affected paths explicitly.

Use `branch(name, { start, upstream })`, `branch(name, { rename: destination })` and `branch(name, { delete: true, force })` for branch operations. Deletion checks merged ancestry and refuses the checked-out branch. Calling `branch()` lists local branches. `tag(name, { target, message, tagger })` creates an annotated tag when a message is supplied, otherwise a lightweight tag. `tag(name, { delete: true })` deletes a tag.

## Merge and replay state

`merge(revision, { ffOnly, noFf, noCommit, squash, allowUnrelatedHistories, style })` supports fast-forward updates and three-way tree merges. `style` is `merge`, `diff3` or `zdiff3`. The content engine honors built-in binary and union drivers. Tree merging follows rename identities and represents add/add, modify/delete, rename/rename, type and directory/file conflicts explicitly. Conflicts populate stages 1–3 and create native MERGE_HEAD/MERGE_MSG files.

The return status is `up-to-date`, `fast-forward`, `merged`, `ready`, `squashed` or `conflicted`. A conflicted result includes the paths and conflict categories. Resolve the files, stage each resolution, then call `merge(null, { continue: true, message })`. `merge(null, { abort: true })` restores the original worktree and index bytes, including unrelated edits present before the merge.

`cherryPick(revisions, options)` and `revert(revisions, options)` accept an ordered list or revision range. Merge commits require `mainline`. Begin replay with a clean tracked worktree; untracked files can remain if they do not obstruct changes. Both operations support `action: 'continue'`, `'skip'` and `'abort'`, plus `noCommit` and explicit empty-commit policy. Sequencer state is persisted before file changes, including native pseudo-refs and todo/head files. A prepared step interrupted before its state transition can be restored and replayed safely.

`rebase(onto, { upstream, todo })` replays the selected commits onto the target. Todo entries are `{ action, oid, message }` records supporting `pick`, `reword`, `squash`, `fixup` and `drop`. A reword step without a message pauses with `needs-message`. The original branch remains unchanged until finalization, which uses a compare-and-swap update. Rebase writes `rebase-merge` metadata and survives construction of a new repository facade over the same stores. Continue, skip and abort use the same action options as the sequencer. Recreating merge topology is a separate operation; ordinary rebase flattens nonmerge commits.

## Stash and recovery

`stash('push', { includeUntracked, all, keepIndex, message })` writes Git-compatible WIP/index/untracked commit parents and updates `refs/stash`. `stash('list')` lists the reflog newest first. Select a saved entry with a numeric `index` or `stashIndex`; `restoreIndex: true` (also `index: true`) restores the saved staging state. `apply` keeps the stash entry. `pop` drops it only after a clean application. Conflicts preserve the stash and expose conflict stages. `drop` rewrites the stash reflog without leaving its tip pointing to the removed entry.

`reset(revision, { mode })` supports soft, mixed and hard scope and records ORIG_HEAD plus a reflog recovery entry. `restore(paths, { source, staged, worktree, ours, theirs })` operates on selected paths. Selecting a conflict stage restores those bytes without automatically declaring the conflict resolved.

## Qualification and limits

Studio comparison operations run in the Git worker. `fileComparison` and `historicalFileDiff` return immutable cached snapshots with at most 1,000 line operations per page; a historical root commit compares against an empty tree. `stageComparisonSelection` and `revertComparisonSelection` require matching before/after object ids and modes, then apply selected operation indexes or an exact hunk anchor. `comparisonDocuments` supplies independent read-only editor models, using bounded excerpts for large files. The UI synchronizes current buffers before applying edits and adopts only accepted file resolutions afterward.

`blamePage({ path, revision, start, count })` returns `{ path, revision, total, start, lines }`. The resolved revision remains fixed across pages. With `workingTree: true`, the worker projects committed attribution through the current working-file diff and marks inserted lines as uncommitted. The returned `workingOid` can be supplied on later pages to reject a changed working snapshot. Blame, diff rows, commit history and changed-file lists render only visible rows. Binary conflicts select an entire side or deletion; text conflicts also support manual and per-conflict resolutions. Conflict resolution checks both the current index-stage ids and the working-file id before replacing any bytes.

Focused tests are in `tests/a25-workflow-*.test.js`. They include generated DIRC fixtures, native Git index/EOL/commit/signature checks, 300 native ignore cases, 150 native patch pairs, 100 native merge-file cases, deterministic minimum-edit-distance checks, 5,000-file checkout, conflict rollback, replay reload, stash separation, recovery and path-policy negatives. Native tests identify the installed Git version and report a skip when Git is unavailable. A native process is used only by qualification tests, never by the portable runtime.

Additional conformance fixtures compare 34 directional merge shapes by exact conflict-index stages and working bytes,
36 rename-similarity thresholds by native `--name-status -M`, and porcelain-v2 records from a real Node filesystem repository.
The 10,000-file status fixture uses both `MemoryWorktree+MemoryObjectDatabase` and `NodeWorktree+FsObjectDatabase` and reports
cold/warm median and p95 timings. Its 500 ms cold and 50 ms warm assertions are engineering targets introduced by this team
in test commit `593b5571`; documentation commit `76208538` incorrectly called them acceptance thresholds. Project 19 does
not specify these numeric status budgets. The distinct #2142 Studio status-bar requirement remains 500 ms after a commit.

Stage 048 at `ccc2b5cf49ba` failed the engineering benchmark: Node cold/warm medians were 365.818/63.194 ms, with warm above
the target; Memory medians were 233.128/20.329 ms. Stage 030 measured the separate #2142 Studio update at 25.1 ms and passed.
See [qualification scope](qualification-scope.md) for source identities, recorded outcomes and platform limits.

Run the status benchmark separately on the serial qualification schedule with
`SHARPFORGE_GIT_PERF=1 node scripts/limited.js node --test tests/a25-status-performance.test.js`;
its default skip is not a passing performance result. Service data tests are in `tests/a25-ui-data-*.test.js`.
Browser and native gate results must be recorded separately after the full implementation scope is ready.

The implementation does not claim that a Node test also validates OPFS, IndexedDB, browser worker scheduling or File System Access permissions. Those adapters require their own platform gates. Exact native behavior across additional diff heuristics, rare attribute encodings, recursive-merge shapes and operating-system filesystem semantics remains subject to the complete integration/reference suite. Unsupported formats and exceeded resource budgets produce stable Git errors; they do not produce a successful result with omitted changes.
