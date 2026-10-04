# Explorer command registration

`ExplorerCommands(host)` is the stable Studio facade. Command families register with
`createExplorerCommandTable`; menus and invocation share that registry and current workspace guards.
The host provides context, dialogs, errors/notices, document navigation and transaction commit callbacks.
The operation-history dependency owns physical adapter/journal execution and undo/redo.

Create, existing-item import, folder, rename, move/copy, delete, include/exclude, build action, linked item,
project/reference and SLNX solution-folder operations prepare their complete edits before committing.
Source-preserving project/solution edits preserve unrelated XML and comments. Rejected move members
require explicit partial-batch consent. Unsafe project-folder relocation is refused. Drop bytes use the
existing bounded transfer contract. Current workspace identity and read sets guard delayed dialogs.

When a C# filename matches a supported type, the rename handler offers the public semantic preview. The
accepted file/project/type changes form one undo entry; declining preserves type spelling. Any changed
semantic input rejects the whole reviewed plan. Native, multi-project, multi-target and unsupported
binding forms retain explicit diagnostics; no textual type replacement is substituted.

Optional workspace, recovery and peer-resolution commands dispatch through explicit host callbacks.
The dependent application composition supplies those callbacks and attaches persistence/disk services.
This batch replaces the old dense facade with registered handlers; it does not edit the Studio entry.

Six operation cases and four semantic command cases cover byte-exact copy/drop and undo/redo, project
rename/reference rewriting, links, partial rejection, unsafe project moves, accepted/declined type
rename, stale preview inputs and unsupported contexts. The four command cases are extracted verbatim
from the full type-rename suite; the five semantic-preview cases already belong to its prerequisite PR.
The exact projection cohort is pending the shared serial validation slot. Browser/native acceptance
remains explicitly dependent on the application/platform qualification report.
