# Native workspace byte provider

`NativeHostFileSystemProvider.connect(client)` is exported by `@sharpforge/workspace`. It uses the authenticated
`MSBuildClient.vfs(method, payload, {signal})` transport and reads actual host capabilities before opening the provider.
The native contribution registers automatically in the host; custom compositions can call `registerNativeVfsServices`.

The provider implements stat, directory enumeration, raw-byte reads/writes, directory creation, rename, delete and bounded
polling watches. Disposal closes every watcher. The native service accepts at most 8 MiB per file and 100,000 entries per
directory. Its JSON byte-array transport fits the host's separate 34 MiB body budget. Operations preserve stable filesystem
error codes and paths, and forward cancellation before reads, queued mutations and commit steps.

All paths use the shared portable path policy and the granted NativeWorkspace root. Reserved paths and symlink components
are rejected; directory enumeration labels unsupported symlink/special entries without following them. Read and mutation
capabilities are explicit. Writes compare SHA-256 baselines, prepare a temporary file, flush it and rename/link it into place;
each operation retains the existing file mode. Multi-file workspace saves remain explicitly non-atomic.

Native operations and workspace saves guard provider writes, including directory creation and the generic service alias.
Read operations remain usable while a build is active. The host does not grant native project execution merely because a
filesystem connection exists; trusted execution continues to use the native engine's separate policy.

Native text reads/saves now reuse the archive codec after the workspace's own admitted-file gate. This preserves UTF-16
without a BOM, existing BOM/encoding choices and unchanged original bytes. Publish profiles and custom project extensions
remain readable even when the archive's automatic text-extension classifier does not recognize their suffix.
