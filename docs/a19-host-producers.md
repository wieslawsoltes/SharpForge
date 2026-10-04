# A19 diagnostic, build-task and Explorer host connections

This completes the production host connections for SF-A19-T06.2 (#1555),
SF-A19-T06.4 (#1557), and SF-A19-T06.5 (#1558). The integration owner runs the
affected test cohort after all three source changes and the concurrent host
contributions are complete. No passing result is claimed for this batch before
that consolidated run.

## Project and designer diagnostics

`StudioProjects` owns `StudioDiagnostics`. Each project synchronization reads
the actual `ProjectSystem` snapshot, maps loading diagnostics to their owning
project, and replaces only that project's `project` producer. Warnings retain
warning severity and do not fail a build. Loading errors prevent compilation
of the affected project and appear once in the shared Error List; the legacy
compiler-result shape still includes them. Reevaluation invalidates cached
builds when loading diagnostics change. Removing a project clears only that
project's store entries.

The ordinary lazy designer configuration receives `projectServices.diagnostics`.
The real `DesignerSourceSync` publishes protected-expression warnings, source
conflicts and failed edits through that provider. Publication captures the
workspace epoch, source record identity/version and complete project membership.
An edit, membership change, removal, workspace replacement or disposal rejects
stale results. A linked source keeps its own project identity when the active
editor changes. An old asynchronous write cannot publish a failure against a
new designer link. Disconnecting clears only its captured designer report.

Error List adds explicit **Project Loading** and **Designer** source filters.
`studio-composition.js` disposes the project diagnostic owner during teardown.

## Build cancellation

`subscribeShellServices` uses `BuildTasks` to connect real build events to
`TaskCenter`. Each task captures both the project compiler epoch and the queue
operation executing that project. Cancel aborts that complete queue, terminates
its current compiler work, and lets the existing queue summary account for the
cancelled project and skipped remainder. An independent queue, a later queued
operation for the same project, and a later compiler epoch remain independent.

The compiler abort listener is installed before the started event. Cancelling
during TaskCenter's synchronous started notification therefore sends no compiler
request. Exhausting the task quota cancels only the untrackable operation and
reports the quota failure; teardown cancels and settles the bridge's own tasks.

## Explorer decorations and accessible names

`studio-composition.js` mounts `connectExplorerProjectDecorations` against the
actual Solution Explorer model and TreeView. It subscribes to startup, session,
build and current-document membership events, and releases every subscription
on teardown. Single, multiple and current-selection startup modes determine
which projects are bold. Build activity and running/paused application counts
are rendered as project badges and included in each row's accessible name.

TreeView accepts an optional `accessibleName` node field through its normal node
metadata. A reused row removes that explicit ARIA label when its new node has no
label, restoring the ordinary visible-text name. Decoration events update node
metadata without rebuilding source records, changing tree focus/selection, or
materializing document text. Unchanged runtime statistics do not redraw rows.

## Regression sources and qualification

| Test file | Production boundary and cases |
| --- | --- |
| `tests/a19-studio-diagnostic-producers.test.js` | Real ProjectSystem → StudioProjects → shared ErrorListModel; actual designer session and safe-action wrapper; warning/build behavior, project removal, source/membership invalidation and asynchronous link replacement. Five tests. |
| `tests/a19-studio-build-cancellation.test.js` | Real BuildServices → BuildQueue → shell subscription → TaskCenter; queue isolation, same-project successor, stale cancellation, synchronous cancellation, standalone/disposal and task quota. Six tests. |
| `tests/a19-studio-explorer-decorations.test.js` | Real project tree builder, TreeModel, TreeView and session/build services; visible/accessibility metadata, selection retention, unchanged runtime events, rebuild/disposal, current selection and reused-row cleanup. Five tests. |

Worker responses and the platform element/event boundary are controlled test
fixtures. These tests do not claim browser layout, screen-reader speech, native
CLR execution or browser-engine qualification. Existing compiler, queue,
designer and session tests remain applicable. No speedup is claimed. Public
package entrypoints are used for cross-package dependencies; the legacy
designer and TreeView dispatch bodies are reduced through focused helpers.
