# Project 16 workspace document layout correction

## Observed failure and source identity

Hosted qualification a4 ran on public source `8d1be9cffa04b0fd7390e5cb6fe5f6c03b997557`
(run `37175293552`, job `111356550684`). Workspace replacement failed with
`Document 'Particle.cs' is not open in this workspace` in the actual multi-session,
HTTP workflow, and Code Definition budget setup. The reported call chain was
`DocumentService.createDocument → StudioDocking.resolve → DockHost.content → createGroupView`.
The complete a4 result remains failed; this source change does not convert any hosted outcome into a pass.

Document ownership had already moved to the replacement workspace. Studio then invalidated the old editor content caches.
`StudioDocking.sync` removed old source panels individually, and each removal synchronously notified the real renderer.
That renderer resolved every tab in each remaining group, including inactive tabs from the old workspace.
The earlier model-only sync fixture used an inert renderer and therefore did not cover this lifecycle boundary.

## Correction contract

The correction applies to document/window ownership in SF-A19-T03.6, T04.3, T04.4, T04.5 and T38.
It preserves the existing document service and retained docking host responsibilities:

- `StudioDocking.sync` completes removal, registration, restore and selection in one existing
  `DockLayout.transaction('syncDocuments', ..., {history:false})` call. No intermediate source set is published.
- Obsolete source views are removed from both content caches and document-tab MRU/closed history.
  Unregistering an obsolete document clears layout history through the existing model API; the outer transaction
  does not add a snapshot containing removed panel identities.
- `StudioDocking.resetDocumentViews()` returns source popouts without an intermediate render, resets editors through
  `DocumentService`, and invalidates source DOM caches. The following sync renders same-URI replacement even if placement is unchanged.
- `DockHost.returnPopout(id, {reopen:false, render:false})` supports this explicit lifecycle boundary.
  Default return behavior still reopens, renders, closes the child, retains element identity and notifies the main-window owner.
- Incremental workspace updates retain surviving model/view/content identity, tool popouts and valid active tool/application selection.
  A missing content provider, failed editor factory or failed subscriber is still an error.

Studio's early `resetEditors` function delegates to this owner instead of reaching into its popout and content maps.
No document/model publication or rename-preview lease behavior changes in this batch.

## Regression source and qualification status

`tests/a19-studio-workspace-layout.test.js` contains eight focused cases using the actual workspace loader,
document service, production editor ownership lifecycle, document-tab policy, and retained `DockHost` renderer.
The test DOM provides adoption, element identity, event disposal and deterministic geometry; editor paint/input remain inert.
These cases cover complete replacement with source/tool popouts, same-URI split views, incremental removal including
floating and closed views, an empty source workspace, metadata-only dirty badges, visible provider failure and recovery,
and both popout return modes.
The assertions require one completed layout publication/render at the workspace transition.

No tests, builds or browsers were executed in this correction worktree. Validation is pending the parent's consolidated
completed-scope slot. The targeted command for that slot is:

```sh
node scripts/limited.js node --test tests/a19-studio-workspace-layout.test.js tests/a19-studio-docking-sync.test.js
```

The actual Studio browser workflows and budget setup must be rerun on the published correction before their hosted status changes.
This deterministic host regression makes no browser geometry, native popout or performance acceptance claim.
