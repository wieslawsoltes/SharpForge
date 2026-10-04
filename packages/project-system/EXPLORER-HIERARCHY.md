# Keyed Explorer hierarchy

`buildSolutionTree(options)` converts workspace records and evaluated/native
snapshots into display nodes without executing a project. Keyed folder and ownership
indexes avoid scanning every existing sibling while admitting files. Complexity is
O(files × path depth + nodes log nodes), including deterministic sibling sorting.

Project dependencies have stable semantic IDs across reorder and separate target
framework subtrees. They preserve project/package/reference/analyzer metadata,
transitive package edges and unresolved diagnostics. Project-owned generated sources
and imports remain under their project; unloaded or unsupported solution project
records become explicit placeholders with their reason instead of disappearing.
Non-file evaluated items such as Using metadata never become physical paths.

`applyFileNesting` combines DependentUpon metadata with common code-behind/designer
and settings-name conventions. Toggling nesting retains node IDs and linked
appearances. `remapExplorerState` maps focused, selected and expanded identities
through physical renames rather than following display order.

`attachLazySymbols` installs source-file materializers; collapsed files retain no
symbol nodes. Expansion includes nested types, constructors, events, delegates and
member kinds, using explicit ownership where available. Nested physical source
children retain their own loaders even when their parent file is collapsed.

The public folder/project/dependency/symbol builders are reusable data APIs.
Actual TreeView rows, keyboard commands, large-workspace paging and disk operations
are dependent UI/provider scopes. This synchronous complete hierarchy is intended
for bounded snapshots; the separate paging model handles large physical trees.
