# Call hierarchy, method completion and bound parameter information

This complete correction batch addresses three concrete acceptance gaps found
by comparing the original Project16 issues with the composed implementation.

| Issue | Requested behavior | Correction and focused evidence |
| --- | --- | --- |
| #1458 / SF-A19-T22 | Lazy, navigable Call Hierarchy for the bound source symbol | `CallHierarchyModel` captures the actual compiler project, URI, version and document/model identity. Every expansion and symbol/call-site navigation keeps that owner and refuses stale sources. `tests/a19-call-hierarchy-ownership.test.js` uses two real project services and production compiler protocol handlers. |
| #1482 / SF-A20-T13 | Completion commit characters insert correctly | The C# completion provider supplies `(` on method items. `tests/a20-method-completion.test.js` joins the actual worker contribution to the production widget and `EditorModel`, including one-step undo, suggestion mode and read-only handling. |
| #1483 / SF-A20-T14 | Parameter information for the active invocation and its overloads | `SourceSemanticModel.signatureHelp` queries captured lossless binder method groups and the selected overload. `tests/a20-bound-signature-help.test.js` covers instance/`this`, accessibility, static members, substituted inherited generics, incomplete calls, named arguments, nested calls and stale requests. |

## Public integration contracts

`WorkbenchShell.openCallHierarchy(location, {signal} = {})` prepares the shared
model and activates its existing lazy tool. A location contains `uri`, `offset`
(or `start`), and optional `version`/`projectId`. Omitted project identity is
resolved by `StudioProjects.serviceFor` using that URI. `StudioProjects.request`
forwards the **selected service's actual ID** to the worker. Hierarchy handlers
return that project ID and each result's own source version; nested queries
retain them regardless of subsequent startup-project or active-editor changes.
Root Studio delegates its existing Call Hierarchy command to this public seam.

The `callHierarchy`, `incomingCalls` and `outgoingCalls` handlers belong to the
existing editor-language contribution. They share its document/version checks;
a nested request also validates the prepared item's URI and project. Request
cancellation propagates to `WorkerClient`, and model disposal aborts pending
operations before they can publish nodes. This moves the old handlers into the
same registration seam without introducing a parallel request implementation.

`SourceSemanticModel.signatureHelp(uri, offset, options)` is a revision-local,
read-only query. The binder records invocation candidates outside executable
bound nodes. This retains the actual receiver and access rules for incomplete
calls without adding syntax-name lookup or modifying emission/flow semantics.
The query index is built once with the source model. It uses sorted opening
offsets, containing-invocation links and direct opening-offset lookup; repeated
queries do not rescan or rebind the source. Candidate display reuses symbol
formatting and bound generic substitutions. A supplied `callStart` selects a
containing invocation, and argument separators come from its syntax list.

No compiler diagnostics are suppressed by parameter information. Unsupported
or unresolved receivers return no tip; this batch does not turn metadata-only
types into executable runtime members. Existing browser/standalone fixtures
remain necessary for real keyboard, layout and CSP qualification. Node DOM
surfaces in the focused fixture are explicitly headless; they are not a browser
or Visual Studio oracle claim.

## Qualification

All three source changes and their focused fixtures are complete before the
batch is run, following the user's requested validation schedule. The requested
serial command is:

```sh
node scripts/limited.js node --test tests/a19-call-hierarchy-ownership.test.js tests/a19-shell-tools.test.js tests/a19-studio-language-providers.test.js tests/a20-method-completion.test.js tests/a20-bound-signature-help.test.js tests/a20-editor-language-worker.test.js
```

At this source-writing checkpoint that command is **pending**. No build, broad
test cohort, browser, native or external compiler oracle has been run for this
correction batch. Existing completed-scope evidence remains in
`docs/a20-insight-coverage.json` and `docs/project16-implementation.json`; it does
not stand in for qualification of these new changes. Invocation retention adds
one analysis-owned record per bound invocation; no performance improvement or
unmeasured overhead figure is claimed.
