# Workspace filesystem services

The filesystem contract separates byte storage, document lifetime, external changes, and editor decisions. All services are scoped to instances. There are no runtime dependencies outside declared SharpForge packages.

## Providers

`FileSystemProvider` defines asynchronous `stat`, `readDirectory`, `readFile`, `writeFile`, `createDirectory`, `delete`, `rename`, and `watch`. Paths are relative to the granted root; the empty string names that root. File contents are `Uint8Array` values. `readDirectory` returns direct children with `{path,name,type,size,mtime}`. `stat` returns the same metadata; `{hash:true}` requests a SHA-256 when supported.

```js
import {MemoryFileSystemProvider, hashFileBytes} from '@sharpforge/workspace';

const provider = new MemoryFileSystemProvider({caseSensitive: false});
await provider.createDirectory('src');
const first = await provider.writeFile('src/Program.cs', new TextEncoder().encode('class Program {}'), {
  expectedHash: null
});
await provider.writeFile('src/program.cs', new TextEncoder().encode('class Program { }'), {
  expectedHash: first.hash,
  signal: abortController.signal
});
```

`expectedHash:null` requires absence; a SHA-256 string requires those exact current bytes. Omitting it opts into the provider's ordinary write semantics. `create:false` rejects missing files; `overwrite:false` rejects existing files. Rename does not implicitly overwrite a target. Recursive directory deletion requires `{recursive:true}`. Byte arrays returned from reads belong to the caller.

| Provider | Storage and commit behavior |
| --- | --- |
| `MemoryFileSystemProvider` | Indexed tree with byte and entry budgets. Single-operation changes are atomic within the instance. |
| `FileSystemAccessProvider` | Granted browser directory handle; permission preflight, exact byte hashes, staged `createWritable` writes. Uses handle moves where available, otherwise bounded copy/delete with cleanup. |
| `OriginPrivateFileSystemProvider` | Persistent OPFS workspace. Large files use a dedicated worker and sync access handles, with cancellable chunked I/O and temporary-file staging. An explicit diagnostic accompanies fallback to async writable streams. |
| `NativeHostFileSystemProvider` | Authenticated `MSBuildClient` `/vfs` endpoint for byte-preserving native files. The host enforces its existing granted-root and symlink policy. |
| `OverlayFileSystemProvider` | Dirty buffers and read-only `generated://` documents over a base provider. `save(path)` flushes the captured byte baseline; external changes remain conflicts. |

Capabilities include `readonly`, `caseSensitive`, `atomicWrite`, `atomicRename`, `watch`, and `persistent`. These describe the active implementation, not a promise that a multi-file operation is atomic. FSA fallback rename reports `atomic:false`; a failure carries cleanup errors if rollback cannot complete. Native writes stage a sibling file and check the baseline before publishing it. Filesystem APIs cannot eliminate all races with unrelated OS processes.

Each operation accepts `{signal}`. Mutation cancellation is checked before commit. OPFS worker cancellation waits for the worker's acknowledgement so a completed commit is returned as success. `dispose()` closes watchers/workers and rejects later use.

`FileSystemError` exposes a stable `code`, `path`, and diagnostic such as `SFVFS_Conflict`, `SFVFS_NoPermissions`, `SFVFS_QuotaExceeded`, or `SFVFS_Unavailable`. Cancellation has `name:'AbortError'` and `code:'Cancelled'`. Unsupported platform capabilities are errors or explicit fallback diagnostics.

## Origin Private File System

```js
import {OriginPrivateFileSystemProvider} from '@sharpforge/workspace';

const files = await OriginPrivateFileSystemProvider.open({
  name: 'project-one',
  onDiagnostic: diagnostic => console.warn(diagnostic.message)
});
const quota = await files.quota(); // usage, quota, available, persistent
```

The default worker URL follows the SharpForge browser deployment layout. Embedders can supply `workerUrl` or `workerFactory`; storage and root path are injectable for controlled hosts. The build contribution bundles the worker under the shipped CSP. `quota()` reports browser estimates and does not request persistence permission.

## Identity and text

Shared archive exports `PathPolicy`, `pathIdentity`, `samePath`, `isWithinPath`, and `comparePaths` define case sensitivity and NFC/NFD identity. Identity never rewrites the original spelling. The default Unicode identity is NFC. Portable path checks reject root escapes, absolute paths, Windows reserved names, control characters, trailing dots/spaces, excessive depth, and excessive length.

`decodeWorkspaceFile` preserves original bytes and detects UTF-8, BOM-marked UTF-16, strongly indicated BOM-less UTF-16, and Windows-1252 fallback. The fallback carries `lossy:true` because the original encoding is uncertain. Unchanged files always encode back to their exact bytes. Delimiter metadata records mixed CRLF/LF/CR endings and the final newline. Normalized edited text can retain those delimiters per line. Saving a character that Windows-1252 cannot represent fails explicitly; the host can choose UTF-8. Binary or malformed UTF-16 input remains binary.

## Change detection and reload

`PollingFileWatcher` gives open paths priority, limits metadata probes and directory entries per tick, and traverses remaining paths round-robin. `setWatchedPaths` updates priority. A 20,000-file folder has a bounded steady-state polling cost; detecting a change in an unprioritized file may require a complete rotation. Initial inventory is chunked and cancellable. FileSystemObserver is preferred where available.

`FileWatchCoalescer` debounces bursts, combines delete/create atomic replacement, recognizes temporary-file rename sequences, and suppresses an own-save event only when its hash matches `markOwnWrite(path,hash)`. A different external hash is never suppressed.

`DocumentReloadCoordinator` uses host callbacks `getDocument`, `replaceDocument`, `removeDocument`, `onPrompt`, and `onReevaluate`. Clean buffers reload with an expected editor version. Dirty buffers retain their text until `choose(path,'reload'|'keep'|'compare')`. Compare returns both texts. Reload verifies that disk content has not changed again. Project, props, targets, and solution changes request reevaluation through the callback. Keeping a buffer does not silently change its save baseline.

An optional `applyChange({path,disk,event,expectedVersion})` callback can atomically replace both documents and project state.
Its return value is forwarded unchanged as `application` in `onReevaluate({path,event,disk,application})`.
A host that already reevaluated the accepted snapshot can acknowledge that work and avoid applying the same event twice.
The coordinator still calls `onReevaluate` for unopened project files, including creation, rename, and deletion.

## Lazy files, search, and bounds

`LazyDocumentStore` registers metadata independently of loaded text. `registerAll` publishes metadata only after complete validation. `load(path,{signal,pin})` admits byte/text costs into the LRU budget; dirty and pinned buffers cannot be evicted. `subscribeEviction` lets Workspace remove corresponding closed SourceText/trees without replacing the embedding host's callback. Budget exhaustion is a diagnostic, not an implicit data loss.

`WorkspaceSearchIndex` maintains character postings for file paths and a bounded decoded-text cache. `findPaths` and `findText` are cancellable async iterators; content search reads closed files on demand and produces early results. `searchPaths` returns scored results. Content queries are literal with optional case sensitivity and Unicode word boundaries. Watcher events invalidate cached content and update path identities. Binary files are skipped; inaccessible files emit diagnostics.

`LazyExplorerTree` in project-system builds indexed directory children and materializes bounded pages on expansion. `loadChildren` returns `{nodes,total,offset,hasMore}`. With `deferIndex:true`, construction stores metadata references and the first expansion builds the index in cancellable time slices. The UI combines page loading with virtualized DOM rows; its `window` helper computes visible rows and spacer heights.

Studio uses a visible paged Folder view when workspace metadata or evaluated project appearances exceed 2,000 entries. This includes the default view of a large solution. The caption and disabled Solution-view choice explain the fallback; the saved view preference is restored when the scope becomes smaller. Project evaluation and build inputs remain available, while the large-scope Explorer presents physical paths instead of eagerly creating project, dependency, and linked-file appearances.

## Studio disk lifecycle

`ExplorerDiskServices` attaches the provider watcher, coalescer, reload coordinator and search index through the explorer lifecycle. It shows skipped paths and explicit Reload/Keep/Compare buttons. File-operation transactions defer external notifications until `fileBusy` clears; exact matching saved hashes and already-adopted deletes do not produce external-change prompts. Directory scans publish complete metadata snapshots only while the workspace identity and revision still match.

The controller installs `disk.findInFiles(query,options)`, returning the existing language-service `{matches,truncated,scannedFiles}` shape. Current editor text overlays provider reads; closed files are searched without materializing disk documents or parsed trees. Search metadata never retains source strings or raw file bytes. Browser component coverage exercises the actual DOM with a memory provider; the provider suite separately qualifies real OPFS and native loopback files.

`ProviderDiskWorkspace.adoptRecords(records,{folders,report,preserveBaselines:true})` validates a complete physical snapshot before replacing its indexes and byte accounting. Independent baselines are SHA-256 hashes. The compatibility `baseline` text view reads retained loaded records and therefore does not prevent unloading. A host must advance hashes only after accepting the new physical state. Browser saves require `saveLocks` based on a physical directory identity, or an asynchronous `resolveSaveLocks`; missing coordination produces an explicit unavailable error.

## Validation

Focused tests cover all providers through Node conformance fixtures, actual temporary native files, permission loss, conflict/quota failures, cancellation, OPFS worker RPC, lazy admission, watch decisions, and 20,000-file scans/search. `tests/browser_a24_vfs_test.py` qualifies actual Chromium OPFS read/write/rename, sync-worker selection, quota reporting, cancellation, and reload persistence under the production HTTP CSP. Native file-picker permission dialogs, non-Chromium browsers, Windows, and macOS require their respective platform jobs before being claimed as qualified.

Run `node scripts/benchmark-a24-workspace.js` for measured 20,000-file registration, folder expansion, path indexing, first-result latency, and admitted memory estimates. The output reports the backend and engine. Memory estimates are explicit admission costs, not process heap measurements.

Use `node scripts/benchmark-a24-workspace.js --defer-index` to measure construction and cooperative index preparation separately. Raw Node and Chromium measurements, exact commands, qualification boundaries and issue-level evidence are retained under `planning/evidence/project18/filesystem.json` and its companion directory. Browser page-expansion timings measure materialization and rendering after index preparation; they do not claim that indexing an entire large workspace completes within one frame.
