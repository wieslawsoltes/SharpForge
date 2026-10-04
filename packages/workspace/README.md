# @sharpforge/workspace

Versioned documents, syntax/result caching and stale-change rejection.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/workspace';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## Filesystem providers

`FileSystemProvider` defines asynchronous, cancellable `stat`, `readDirectory`,
`readFile`, `writeFile`, `delete`, `rename`, `createDirectory` and `watch`
operations. Paths are portable and root-relative; the empty path denotes the
root for directory operations. `readDirectory` returns direct children with
`path`, `name`, `type`, `size`, `mtime` and an optional exact-byte `hash`.
Contents are `Uint8Array` values; reads and writes do not share mutable buffers.

Capabilities explicitly describe case sensitivity, persistence, read-only state,
watching and atomic writes/renames. `writeFile` creates or overwrites by default;
`create: false` and `overwrite: false` constrain that behavior. An `expectedHash`
requires the saved SHA-256 baseline, while `expectedHash: null` requires absence.
Writes check cancellation before committing and report an already committed
write as success. `FileSystemError` has stable `code`, `path` and `diagnostic`
fields; cancellation uses `AbortError`. Unsupported operations report
`Unavailable`, and every operation after `dispose()` reports `Disposed`.

`MemoryFileSystemProvider` implements the whole contract with an indexed tree,
owned bytes, synchronous commit boundaries and provider-local subscriptions.
Its default limits are 128 MiB and 100,000 entries including the root; path lookup
is proportional to depth and enumeration to direct children. Rename never
overwrites implicitly. `watch` returns a disposable subscription and accepts an
`AbortSignal`. `ProviderEvents` exposes that same subscription seam to adapters.

`hashFileBytes` and `hashWorkspaceBytes` compute WebCrypto SHA-256 over exact
bytes, including BOMs. `workspaceRecordBytes` delegates to the archive codec so
baselines and saves agree. `asFileSystemError` normalizes native/DOM failures,
`throwIfCancelled` checks provider cancellation, and `assertExpectedHash`
performs an explicit baseline comparison for an adapter.

Focused validation: `node scripts/limited.js node --test
tests/a24-vfs-memory.test.js tests/a24-path-encoding.test.js`. The shared provider
conformance helper is reusable by each complete storage implementation.

## Prepared source record foundation

`workspaceRecordSource`, `cloneWorkspaceRecordSnapshot`, `hashWorkspaceRecord`
and `workspaceRecordBytes` accept immutable prepared roots without reading the
compatibility text getter. The [prepared-source contract](PREPARED_SOURCES.md)
describes exact encoding, bounded hashing, and the dependent journal/recovery
composition across the completed Project 18 source stack.

## Change observation

`PollingFileWatcher(provider, listener, options)` scans metadata once, then
prioritizes `watchedPaths` and rotates through the remaining inventory. A
saturated priority set rotates too, retaining a bounded background share; a
one-stat budget alternates priority and background work. Configure
`maxStatsPerTick`, `maxDirectoryEntriesPerTick`, `maxEntries` and `intervalMs` to
bound each interval. Open files receive exact-byte hashes so equal-size changes
are visible. `start({schedule: false})` and `poll()` support deterministic hosts;
`setWatchedPaths` changes priority without restarting. Dispose ends scheduled
work and suppresses subsequent callbacks. Enumeration uses `iterateDirectory`
when a provider supplies it, otherwise bounded provider directory results.

`observeFileSystemHandle` adapts `FileSystemObserver` records and returns a
disposable subscription, or `null` when the API is unavailable/unsupported so
the caller can select polling. Permission failures remain explicit errors.
`FileWatchCoalescer` collapses create/delete/rename save bursts and suppresses an
own write only when its exact hash matches; an unrelated external write stays
visible. Hosts call `markOwnWrite(path, hash)` after successful persistence.

Focused validation: `node scripts/limited.js node --test tests/a24-vfs-watch.test.js`.
The deterministic 20,000-file inventory checks per-interval operation budgets;
it does not claim an operating-system notification latency measurement.


## Granted browser directories

`FileSystemAccessProvider(directoryHandle, options)` implements the provider
contract for a previously granted directory. It queries permissions before I/O;
a write operation with `{requestPermission: true}` can explicitly request a
write grant. A denied grant reports `NoPermissions` without opening a writable
stream. Metadata enumeration supports `iterateDirectory` and does not read file
contents when metadata is disabled. Limits bound individual files and recursive
operations, and all paths stay inside the granted root.

Writes use `createWritable` and become visible only after `close`; failed or
cancelled writes abort their stream. Exact hashes guard replacement. Rename
uses the handle's native move capability when available; the fallback copies
bytes, verifies the original source tree again, and only then removes it. A
concurrent source-tree change preserves the original and rolls back the copied
destination. Capabilities report the fallback as non-atomic. Watch prefers
`FileSystemObserver` and uses the bounded poller when observation is unavailable.

Focused validation: `node scripts/limited.js node --test tests/a24-vfs-fsa.test.js`.
The deterministic handle fixture covers byte identity, permissions, failed
writes, cancellation and concurrent directory rename. Actual browser handles
and operating-system folder pickers require separate browser qualification.
