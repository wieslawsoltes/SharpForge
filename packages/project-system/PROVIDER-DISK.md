# Provider-backed disk records

`ProviderDiskWorkspace`, `readProviderDirectory(handle, options)` and
`readProviderFiles(files, options)` are additive APIs. Legacy `DiskWorkspace`,
`readDirectory` and `readBrowserFiles` keep their existing behavior until the Studio
application integration switches those aliases. The provider API supplies metadata,
read/admission, snapshot lifecycle and explicit physical write operations.

Large directory imports enumerate metadata first and eagerly read only project
evaluation inputs and explicitly opened paths. Unloaded records have `lazy: true`
and never stand for empty source text. Reports retain skipped/non-portable paths.
The existing configured file, entry and total loaded-byte budgets apply throughout.
`load`, `hydrate`, `unload`, `record`, `canonicalPath` and `adoptRecords` manage state
without opening editors. Loaded raw bytes define SHA-256 physical baselines.

Load captures entry/provider/hash/handle identity, checks each awaited result,
then calls optional synchronous `beforeAdmit(record)` immediately before publication.
Throwing or returning a Promise rejects without publishing bytes, hashes or handles.
Loaded versions advance monotonically; unload retains path/size/lazy/version/mtime
metadata and releases content. Snapshot adoption validates all entries/budgets before
replacing indexes, retaining baseline hashes only for surviving physical paths.

The root application integration will alias `DiskWorkspace` to `ProviderDiskWorkspace`
and `readDirectory`/`readBrowserFiles` to `readProviderDirectory`/`readProviderFiles`
only after its lazy editor and explicit physical-identity/save-lock hooks are present.
No automatic identity lookup or hidden permission management is introduced here.

## Save and directory mutations

`save(changes, options)` pre-encodes and checks every path, byte budget, baseline and
permission before opening a write. It preserves raw-byte identity including BOM,
line endings, XML and binary content. `create`, `rename`, `move`, `delete` and
`mutate` share the same per-workspace operation queue. Save publication advances
document versions; closing and reopening a saved file retains that watermark.

Inject a `WorkspaceSaveLocks` instance whose identity was resolved from the physical
directory by `RecentWorkspaceHandles.identify`. Browser saves require the coordinator;
an explicit `resolveSaveLocks` callback may await an existing host-owned setup.
This API never assigns a name-derived identity or initializes permissions implicitly.
The held ownership signal reaches both the actual baseline read and physical write.

Multi-file saves and directory-handle mutations are explicitly non-atomic. Successful
calls report completed paths; failures retain `written`/`hashes` or `completed`
receipts so the host can reconcile completed physical effects. The separate workspace
transaction adapter supplies durable multi-operation recovery when needed. Direct
directory mutation batches reject overlapping paths and preserve canonical casing.
Host-level multi-window coordination for a whole mutation journal remains separate
from these provider primitives. No changes to the legacy Studio entry are included.
