# Lazy folder model

`buildLazyFolderTree(options)` returns `{roots, model}`; `LazyExplorerTree` is the
underlying public model. File records carry paths, optional sizes/kinds and `lazy`
metadata. Directory indexing is O(total path components); each materialized page is
O(page size), after one deterministic sibling sort. `deferIndex: true` postpones
cooperative indexing until the first expansion, without constructing file nodes.

Nodes keep stable `folder:<path>` and `file:<path>` IDs. A folder's asynchronous
`loadChildren({offset, limit, signal})` returns `{nodes, total, offset, hasMore}`.
The default page size is 100, the maximum is 1000, and file/directory metadata is
bounded by 100,000 total entries. Cancellation and invalid pages reject explicitly.
`window({count, scrollTop, viewportHeight, rowHeight, overscan})` bounds fixed-height
visible rows independently of the file count. `dispose()` releases model metadata.

The Studio `explorerViewPolicy` selects a visible paged Folder view when physical
files, linked project appearances, imports or generated items exceed 2000 entries.
It uses collection lengths rather than constructing a full hierarchy and retains
the user's requested view preference. The dependent Explorer view integration owns
actual load-more controls, row rendering and the explanatory toolbar text.
