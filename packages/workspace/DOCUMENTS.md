# Bounded document admission

`new LazyDocumentStore(provider, options)` separates file metadata from loaded content.
`register` and `registerAll` accept metadata only (`path` or `uri`, size and caller tags).
They reject text/byte payloads. Registration does not read files or parse syntax.
Defaults are 100,000 metadata entries, 8 MiB per file and a 64 MiB loaded-content budget.
Loaded cost is exact byte-array length plus two bytes per UTF-16 text code unit.

`load(path, {signal, pin})` reads, decodes and hashes a file, then admits it only if
the same metadata entry/generation is still current. `admit`, `update`, `markClean`,
`pin`, `unload`, `invalidate` and `remove` explicitly own cache state. The LRU evicts
clean unpinned entries first. Dirty or pinned content is retained; exhausted budgets
fail with `QuotaExceeded` before replacing an existing buffer. An oversized file
fails with `FileTooLarge`. Changed entries fail pending loads with `Conflict`.

`subscribeEviction(listener)` returns an unsubscribe callback; the constructor's
`onEvict` callback remains independent. `metrics` exposes reads, hits, evictions and
admitted bytes. `dispose()` clears content and makes future loads fail explicitly.
SourceText/syntax ownership and actual editor close/reopen integration belong to
the dependent Workspace/Studio lifecycle batches; this cache does not open editors.
