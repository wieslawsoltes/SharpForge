# Workbench debug source ownership

Each application session owns the verified source records received from its runtime
worker. Activating another application selects that owner's records; launching or
restarting one application clears only its own records. The workspace state facade
exposes the selected application's maps without becoming a second owner.

`SessionBreakpoints.set(projectId, uri, breakpoints, {sourceText})` keeps user anchors
under the workspace URI, then binds them to verified execution URIs in applications
whose launch envelope includes that project. A text or project mismatch returns an
explicit failure and sends no breakpoint request to that application. Applications
unrelated to the project receive no request. Calls without verified records retain
the existing URI fallback.

`forProject(projectId, dependencies)` merges requested anchors for a startup project
and its built dependencies. The launch orchestrator supplies those dependency IDs
from its completed project artifacts while preserving its existing launch queue,
cancellation, application activation and failure ownership.

Source breakpoint controls may delegate synchronization to the workbench even when
no application is active. Editor decorations still resolve verified execution text
and accept the workbench's combined diagnostic producer view.

## Dependencies and qualification

This composition requires the actual published project build, debugger editor and
workspace recovery state foundations. The dependency branches contain their real
parents; the feature adds only the session, breakpoint and decoration composition.

The four direct cases in `tests/a24-workbench-debug-provenance.test.js` passed in the
root Node 26 scope at `bb2b8d84`. Their source remained identical through `7b087e0f`
and `5269d397`, whose full Node 22 scope passed all 1,877 cases. The earlier broad
Node 26 run retained 66 failures elsewhere and is not described as an overall pass.
These are module contract results; protected Studio entry wiring and browser
execution remain separately qualified work.
