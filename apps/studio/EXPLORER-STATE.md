# Lazy Explorer state

`SolutionExplorer.render` retains stable identities across a metadata rebuild.
When a new lazy index has not materialized the selected row, `lazy-state.js`
resolves the saved focus, selection, scope and expanded folders before restoring
their state. It loads the containing page for each ancestor and the first page
of each expanded folder. It never opens source files or reads their contents.
Missing paths disappear from the selection; transaction mappings preserve the
renamed path and its scope. An unchanged active editor does not replace a
different row selected by the user during refresh.

Restoration stages the complete set of pages and validates their identities and
tree bounds before publishing the restored hierarchy. A workspace replacement,
source revision, tree replacement, user selection, filter change, scroll or
cancellation retires delayed work. Repeated renders during indexing retain the
original requested state. Current provider or malformed-page failures surface
through the Explorer error callback and do not publish a partial restoration.

Scoping changes the visible roots without rebuilding the physical index. Child
admission updates the matching subtree in the full cache, so Home retains the
pages admitted inside the scope. A physical disk replacement creates a new lazy
index even when its display identity and numeric revision match the prior one.

For `K` saved identities with maximum path depth `D` and page size `P`, resolution
allocates at most `O(K × D × P)` metadata before deduplicating repeated pages.
Admission is limited by the tree's node/depth budgets; directory indexing uses
the existing cancellable lazy index, and the restoration loop yields between
identities after approximately 8 ms. The scoped cache walk is linear in the
already admitted nodes. These are algorithmic bounds, not measured UI latency.

The focused controller cases are in
`tests/a24-explorer-state-restore.test.js`. They exercise the actual view render
method with host callbacks and the public lazy model. DOM focus retention,
browser storage and viewport latency remain separate browser qualification.
