# Workspace document navigation

`createWorkspaceNavigation(host, options)` composes the editor package's existing
`NavigationHistory` with asynchronous document opening. The host supplies
`history`, `context`, `currentLocation`, `openFile`, `setReplay`, and
`renderButtons`. `context()` returns a workspace `identity`, its `disk`, and the
complete metadata `records` collection, including unloaded source files.

`navigate('back' | 'forward')` returns a promise for the selected location, or
`null` when no current target exists. Missing members are skipped; an unloaded
member remains a valid target. Requests run in order, and failed opens leave the
history position unchanged. The original cursor location is retained after a
successful open. The host's guarded loader remains responsible for refusing
stale file bytes before it publishes an editor or workspace record.

The pending queue defaults to 32 requests. Its configurable limit must be an
integer from 1 through 10,000; excess requests reject without starting I/O.
Each request indexes the current membership once and scans only the bounded
history. The controller retains locations and workspace identity, not file bytes.

Call `cancel()` when resetting editors or replacing the workspace. It retires
queued requests and releases queue capacity. A completion cannot advance a
history that has been replaced or changed during its asynchronous open.

`closeOtherSourceDocuments(context, retainedId)` closes each other source through
`docking.layout.close` and awaits the normal `docking.host.onClose` lifecycle
before focusing the retained document. This allows clean-document cache release
and dirty-document retention to use the same host boundary as an individual close.

The controller contract and context-menu path are exercised by
`tests/a24-workspace-navigation.test.js`. Connecting the history controller to
the protected Studio entry and qualifying the complete browser workflow remain
part of the application integration; module tests do not claim that coverage.
