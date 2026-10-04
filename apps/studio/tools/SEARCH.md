# Workspace search panel

`createWorkspaceSearchPanel(context)` composes the existing `requestCompiler`,
`loadWorkspaceRecord(path, {signal})`, and `openFile(uri, start, end)` callbacks.
The host supplies `explorerContext()` with the current workspace identity,
revision, disk/provider references, and records. Call `observe()` during tool
rendering and `dispose()` when the renderer is destroyed.

The controller accepts the LanguageService/provider `findInFiles` result shape.
Each query captures the workspace and document versions. A newer query cancels
the previous wait, and a late result or failure cannot replace the current panel.
Cancellation reaches the provider through `params.signal`; compiler requests
that cannot be interrupted are ignored after cancellation.

Result navigation checks current membership, identity, revision, and document
version before using UTF-16 offsets. Lazy records load through the session's
guarded admission callback. Their admitted version may advance, but the original
literal match and Unicode whole-word boundaries must still hold before opening.
Subsequent navigation accepts that exact admitted watermark. Changed results
offer an explicit **Search again** action.

Replacement previews retain the existing version-checked refactoring API and
are fenced against query and workspace changes before their modal or edits are
applied. They do not bypass the refactoring service's supported source scope.

Focused regression files are `tests/a24-workspace-search.test.js` and
`tests/a24-workspace-disk-events.test.js`. Their new cases are pending the shared
final qualification; no browser or native success is implied by this extraction.
