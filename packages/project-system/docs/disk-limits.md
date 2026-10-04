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
  maxFileBytes: 128 * 1024 * 1024,
  maxAssemblyBytes: 128 * 1024 * 1024,
  maxTotalBytes: 160 * 1024 * 1024
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

Focused regression command:

```sh
node --test tests/a20-large-file-disk.test.js tests/project-system.test.js tests/workspace-io.test.js tests/release04.test.js
```

The large-file fixtures exercise sources over 2 MB, inherited opt-in limits, UTF-16 encoding/BOM limits,
aggregate preflight, queued versions, external changes and permission-time changes. Existing disk/project
and workspace I/O regressions remain in the same consolidated validation run.
