# Host document split direction and workspace targets

SF-A19-T38 / #1474, SF-A20-T08.3 / #1625 and the Emacs/VS Code host split
bindings share `createStudioEditorHost`. A source audit found that horizontal
splits first created a right-hand view, then split that new single-view group
below itself. With the default retained-empty-document-group policy this left
an unwanted empty group; it did not create one bottom group relative to the
original source.

`DocumentTabs.newView(id, {axis = 'vertical'})` now captures the original group,
opens the shared view in that group and performs exactly one split in the
requested direction. A vertical document split places the new view to the right;
a horizontal document split places it below. The corresponding DockLayout axes
are horizontal and vertical respectively. The old `newView(id)` New Window
contract retains its right-hand default. Model/undo identity and copied initial
caret/scroll state remain shared/independent as before.

`DocumentTabs.split(id, axis, {groupId?})` accepts an explicit existing anchor
group. Host `:split filename` / `:vsplit filename` normalize a logical workspace
path through the public project-system API, require a current source record,
open it through the existing authorized workspace opener, then move that exact
view beside the original group. They create no extra duplicate view of another
file. A path naming the current source uses a new shared view. Absolute paths,
URLs and unknown workspace sources are explicit errors. A cancelled opener or a
group removed during the asynchronous open does not create an extra split.

The focused tests drive actual DocumentService, EditorModel, DocumentTabs and
DockLayout through the production host adapter. They assert exact tree axes,
group counts, selected source identity, one dock operation, dirty/undo and view
state retention, source-path resolution and failure boundaries. They are Node
model/host tests; physical Vim/Emacs key delivery and actual browser rendering
remain separate qualification.

After the complete source scope was written, this limited batch passed 23/23
cases (nine new host/split cases plus 14 retained document-tab and Studio sync
cases), with zero failures or skips in 481.208983 ms:

```sh
node scripts/limited.js node --test tests/a19-studio-editor-splits.test.js tests/a19-03-document-tabs.test.js tests/a19-studio-docking-sync.test.js
```
