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
