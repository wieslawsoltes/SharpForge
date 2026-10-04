# Provider-backed disk records

`ProviderDiskWorkspace`, `readProviderDirectory(handle, options)` and
`readProviderFiles(files, options)` are additive APIs. Legacy `DiskWorkspace`,
`readDirectory` and `readBrowserFiles` keep their existing behavior until the Studio
application integration switches those aliases. This first batch supplies metadata,
read/admission and snapshot lifecycle operations; save/mutation methods follow in
the dependent disk-writes batch.

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
