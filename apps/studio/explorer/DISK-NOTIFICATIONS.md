# Disk notification surfaces

`DiskServicesView(view, {choose, open})` renders bounded skipped-path reports,
external-change decisions and path-search results. The host supplies `element`,
`tree` and its owning document. Report pages replace the previous 100 rows, so
large rejected inventories do not allocate an unbounded DOM. Native buttons and
summary/details retain keyboard activation; status and result regions are labelled.
Comparison panes are read-only and display both local and external text.

`choose(path, choice)` receives reload/keep/compare, and `open(path)` receives the
selected result. These callbacks own all mutation. `reset` clears transient state;
`dispose` removes the component root. The registered stylesheet supplies bounded
overflow and visible keyboard focus. `ExplorerDiskServices` supplies live watcher,
search and reload behavior in a dependent batch; the protected Studio host wiring
remains application integration.

Node render tests use a small explicit DOM adapter. They verify bounded row counts,
labels, callback routing, both comparison values and disposal; this adapter does
not qualify browser layout, focus navigation, or native picker permissions.
