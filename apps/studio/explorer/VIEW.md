# Solution Explorer composition

`SolutionExplorer(element, callbacks)` composes the public TreeModel/TreeView, project hierarchy,
bounded folder paging, drag/drop admission, recovery/revision controller and provider disk services.
The host supplies current workspace data, document open, registered commands, menus, properties and
error callbacks. Its `getData()` carries `disk`, `provider`, identity, revision, records, snapshot, dirty
paths, tabs and busy/read-only flags when available.

Tree state, file nesting, view preference, scope, active tracking and scroll position survive rebuilds.
Transaction mappings are applied through stable project-system identities. Search and keyboard actions
share the same command path as toolbar/context menus. For scopes above 2,000 metadata entries the
caption explicitly selects paged Folder view; the saved Solution preference resumes in smaller scopes.
Initial folder indexing is deferred and cancellable, with 100-child pages and virtual TreeView rows.

`ExplorerChildLoader` coalesces matching expansion/page requests. The loader function is the admission
identity: TreeModel cloning preserves it, whereas a rebuilt source/workspace supplies a new function.
Retired or cancelled responses cannot publish into a same-ID replacement. Children and ancestors are
staged before TreeModel validation, so duplicate or malformed pages cannot corrupt the current tree.

Track Active and Sync resolve unloaded physical paths through `resolveLazyExplorerPath`. The shared
metadata index locates the containing page of each ancestor by binary search; node admission is bounded
by depth times page size rather than by the number of preceding siblings. A reveal stages the entire
ancestor chain, preserves expanded nodes on overlapping pages, and leaves a paging action at the first
unloaded interval. Workspace, provider, revision, scope and request identities fence delayed results.
`reveal(path, focus)` returns a promise of a boolean; missing paths and retired requests return false.

The view observes recovery and disk services on render, exposes guarded document-cache release hooks,
and disposes child admission, indexing, drag/drop, storage/channel/lock resources and subscriptions.
The application host still owns workspace/session loading, physical save choices and compiler wiring.

Five focused child-loader cases cover positive expansion across model clones, same-ID replacement,
duplicate-page admission, stale/cancelled responses and invalid staged trees. Six direct reveal cases
cover a 21,000-file directory, Unicode/case identities, ancestor admission, overlapping pagination,
source replacement, disposal and atomic rejection. Model/FS foundations have
their own focused evidence; actual production Studio composition and browser/OS behavior must be
qualified on the integrated application rather than inferred from these helper cases.
