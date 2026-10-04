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
return that project ID, project configuration revision and each result's own source version; nested queries
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
Invocation capture is enabled by source-model analysis; ordinary compilation
fallback keeps no editor candidate records. A model reusing a complete fallback
preserves it for ordinary queries and privately captures candidates on its
first signature request, retaining the same parsed files and effective options.
This extra analysis is cached and its first-query time/heap cost has a separate
benchmark phase. The query index is built lazily once per requested document
within its source model. It uses sorted opening offsets, containing-invocation
links and binary opening-offset lookup; repeated queries do not rescan or
rebind the source. Candidate display reuses symbol
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

The root coordinator ran the completed corrective scope at
`4b1c02914fcb512e963eb1f824598548e5bcf884`: **305 tests, 302 passed, three
failed, zero skipped**. Its retained log is `p16-correction-cohort.log` in the
session qualification artifacts. All **19 new cases** in the three files above
passed: seven Call Hierarchy, eight bound-signature and four completion cases.
This is actual Node/provider evidence, not a browser or external-oracle pass.

One older failure was in `tests/a19-studio-composition.test.js`: it required the
worker parameters to omit `projectId`. That encoded the behavior intentionally
changed by the Call Hierarchy ownership fix. The corrected assertion requires
the exact Beta compiler service ID for both URI-routed and explicitly selected
linked-file requests. Existing assertions that the selected build/startup
project remains Alpha are preserved, with an additional startup assertion
after the linked-file request. The affected-file rerun is **pending** at this
checkpoint; the other two failing fixtures are owned by the shell lane.

Existing completed-scope evidence remains in `docs/a20-insight-coverage.json`
and `docs/project16-implementation.json`. Invocation retention adds one compact
analysis-owned record per bound invocation. The first complete before/after
measurement and its two binding-budget flags are recorded in
`docs/a20-provider-binding-benchmark.md`. The subsequent compact-record/lazy
index correction, four focused lookup cases and revised first/repeated-query
measurements are prepared but **not yet run** at this source checkpoint. No
performance improvement from that correction is claimed. No browser, native
or external compiler oracle was run for this correction batch.
