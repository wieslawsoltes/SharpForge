# Explorer hierarchy and file-operation contracts

The public project-system entry point exposes display-only hierarchy builders. They consume
evaluated project records and workspace membership. They do not restore packages, execute
project targets, modify files, or grant access to a directory. Studio composes these builders
with its keyed `TreeView`, command registry, transaction journal and workspace session.

## Public surface

| API | Input and result | Behavior and limits |
| --- | --- | --- |
| `buildSolutionTree(options)` | `{snapshot, files, folders, name, startup, dirty, generated, symbols, view, showAll, nesting, expanded}` → root nodes | Solution/project membership, solution folders/items and unloaded project placeholders; folder view uses physical membership. `files` use `path` or `uri`. |
| `buildProjectTree(project, context)` | Evaluated project plus indexed file map, folder builder and ownership sets → project node | Compile/non-source/linked items, physical excluded files, project XML, dependencies and generated/import groups. Non-file evaluated items are excluded from physical display. |
| `ExplorerFolderBuilder` | Shared per-build folder index; `file` and `folder` append nodes to a parent | Avoids rescanning siblings when inserting paths. Physical path identity stays independent of labels and nesting. |
| `buildDependencyTree(project, projectId)` | Framework/package/project/assembly/analyzer records and optional target contexts/assets graph → dependency group | Target-specific groups, transitive package children, versions and unresolved diagnostics. Cycles or depth above 64 produce visible `SFP2401` nodes. |
| `applyFileNesting(projectNode, {enabled})` | Existing project display nodes → same project node | `DependentUpon` and conventional `.xaml.cs`, `.Designer.cs`, `.g.cs`, partial-source and `appsettings.*.json` relationships. Cyclic relationships remain flat. |
| `appendProjectExtras(node, project, generated)` | Evaluated imports/generated records → enriched project node | Generated appearances carry their source/project identity and remain read-only; imported project inputs remain visible. |
| `buildUnloadedProject(project)` | Preserved solution entry → unloaded placeholder | Non-C# or unavailable projects retain their name, type and diagnostic rather than disappearing. |
| `buildSymbolChildren(file, symbols, options)` | Symbols with `uri`, kind, identity/owner or source spans → type/member nodes | Includes records, structs, interfaces, enums, delegates and member kinds. Default 5,000-symbol budget produces a visible limit diagnostic. Malformed owner cycles are detached. |
| `attachLazySymbols(root, symbols, {expanded})` | Existing display tree and flat compiler symbols → same root | Collapsed files allocate no symbol nodes. `loadChildren()` materializes that file's types/members while retaining nested physical children. |
| `explorerNodeId(kind, owner, identity)` | Logical appearance identity → stable string | Different project/linked appearances remain distinct. Expansion and selection survive a repeated build. |
| `remapExplorerState(state, oldNodes, newNodes, mappings)` | Tree snapshot plus physical `{from,to}` mappings → restored state | Renames remap selected/expanded appearances while respecting project ownership and logical node kinds. |
| `buildLazyFolderTree(options)` | `{files, folders, name, pageSize, deferIndex}` → `{roots, model}` | Metadata-only construction and cancellable pages. With `deferIndex`, path indexing yields cooperatively during expansion. Dispose the model on scope replacement. |

Tree nodes expose `id`, `kind`, `label` and optional `path`, `project`, `children`, `branch`,
`badge`, `diagnostic`, `dirty`, `readOnly`, `linked`, `excluded`, and `loadChildren`. Consumers
must dispatch by kind and capability. A display node is not permission to mutate its path.
`loadChildren` may return an array for symbol nodes or `{nodes, total, offset, hasMore}` for
paged directory nodes. Studio normalizes both contracts and exposes a keyboard-operable
“Load more” row. Large scopes above 2,000 entries visibly use paged Folder view; the saved
Solution-view preference resumes when the workspace becomes smaller.

## Source-preserving project edits

`editProjectMembership` and `editNamedProjectItem` delegate to the project-edit CST core.
`rewriteProjectPaths` applies a complete mapping batch against original literal attribute
values, preserving quote style, XML entities, comments, whitespace, and unrelated conditions.
`rewriteProjectPath` is the single-mapping convenience wrapper. Import-relative paths are
rebased once if their containing file moves. Unknown project expressions are not treated as
literal filesystem names. Solution mutation helpers preserve `.slnx` structure and the legacy
reader retains unloaded entries; the native/legacy configuration editing core is documented
with the MSBuild workstream.

## Application operation seam

`ExplorerCommands` is the stable Studio facade. Its registry routes menu, keyboard, clipboard,
internal drag/drop, external file drop, and command calls through the same admission boundary.
The host supplies context, an atomic session commit, explicit dialogs, error presentation,
the explorer lifecycle and optional semantic rename support. New behavior belongs in an
operation module registered by `createExplorerCommandTable`.

Browser-directory operations use `ProviderTransactionAdapter` and the bounded
`FileOperationHistory`. A full plan is checked before physical writes; completed mutations
are persisted as OPFS receipts. Undo/redo check exact current bytes and membership before
applying an inverse. Unrelated dirty editors keep their unsaved contents and old disk
baselines. A failed multi-file write reports the actual completed paths; it cannot promise
filesystem-wide atomicity. In-memory hosts use the same planning and history logic without a
physical adapter. Native undo delegates to the host quarantine receipt; native redo is
explicitly unavailable and requires a fresh reviewed operation.

Cross-project moves, include/exclude/delete, linked files and project/solution rename use
source-preserving XML edits in the same transaction as affected file bytes. Clipboard items
are grouped under one history entry, safe copy names avoid case-folded collisions, and a
partially valid batch requires a reviewed choice with rejected paths enumerated. Workspace
identity, cancellation, read-only/build state, stale source reads and portable path constraints
are checked before applying changes.

When a `.cs` filename matches a declared type, `prepareExplorerTypeRename` requests a semantic
plan through the language service. The confirmation can include type declarations and bound
references in the file/project transaction or decline to rename only the file. The plan
rejects changed input versions and unbound/capturing references. Native or multiple-project
contexts, aliases, documentation references, inactive declarations and edits to generated
sources currently produce explicit unavailable reasons; they are not guessed with text
replacement.

Peer-window resolution is a separate buffer operation. The host binds
`applyWorkspaceConflictResolution(host, session, resolution)` and retains its dirty result
until an explicit Save-to-Disk action. It must not route this callback through physical file
history. See `packages/workspace/TRANSACTIONS.md` for exact-byte save/recovery contracts.

## Examples and evidence

Run `node examples/explorer-integrity.mjs` for a two-project solution with linked/dependent
items, generated nodes and a project rename restored through undo. Run
`node examples/workspace-integrity.mjs` for byte-preserving transactions and recovery.
`planning/evidence/project18/workspace.json` maps the owned issue acceptance criteria to
implementation paths, raw validation logs, browser qualification and remaining platform gaps.
The eager hierarchy benchmark records an 8% cold regression on a shared machine and a lower
warm median; it is not a controlled performance sign-off. Large UI paging is measured
separately in the filesystem evidence rather than inferring a frame budget from Node timing.
