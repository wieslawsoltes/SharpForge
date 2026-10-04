# Project 16 Studio composition

This scope connects the independent editor, document, project, runtime and workbench services to Studio.
It retains the original implementation histories and adds explicit host adapters in small Work-ID commits.
The complete scope is qualified after assembly; individual host edits do not trigger heavy CI.

## Ownership and source I/O

`WorkspaceLoads` belongs to one Studio instance. An opening ticket starts before a picker or asynchronous
read, remains the same through nested format handlers, and is checked immediately before adoption.
Newer opens, document edits, backend changes, execution locks and disposal invalidate older requests.
`StudioWorkspaceInputs` retains that ownership across browser input events, including a cancelled
picker whose result arrives after a different workspace has opened.

`studio-file-import.js` routes loose C# sources, folders, projects, solutions, ZIPs, JSON bundles,
assemblies and IL files. Recovery bundles preserve source overrides, encoding/BOM metadata and empty
binary files. Samples and embedded assembly sources use the same captured opening ticket and publish
matching workspace metadata before document reset notifications.

`studio-workspace-loader.js` validates a complete candidate before replacing live documents. It measures
encoded file and workspace budgets, preserves immutable source snapshots, restricts active source tabs
to actual C# documents and consumes prepared models only after successful adoption. Rejected candidates
release every model still outside the live document service. Callback failures after adoption retain
the committed model and report `DOCUMENT_COMMITTED`.

The browser source limits are 20,000 workspace files, 256 MiB per source/file and 320 MiB in aggregate.
Automatic JSON recovery has a separate 8 MiB budget. Explicit file save and streamed source ingress
remain available when automatic recovery cannot represent the workspace. Large-file limits do not
imply that automatic semantic analysis or compilation is enabled for a 200 MiB document.

## Saving and file transactions

`StudioSave` captures the actual record and source root. A required Save As picker is acquired before
asynchronous normalization, and only its returned normalized snapshot can become the saved baseline.
The chosen handle remains the target of subsequent single and bulk saves for that exact document.
Bulk saves group sources by their effective destination; partial failures acknowledge only completed
writes, and edits made during I/O remain dirty. Cancellation, record replacement and disposal prevent
late callbacks from repopulating targets or marking a replacement document saved.

Native save completion additionally requires the captured client and backend. Native Save As is not
advertised through the browser picker because the native host owns its destination policy.

`StudioDiskObserver` reads the effective Save As target using its known encoding and an 8,000,000-code-unit
automatic watch limit. FileWatch actions retain the exact document and observation token. Reload checks
the current file again, commits source and encoding metadata through `DocumentService.reload`, and accepts
the matching disk baseline on the same save queue before notifications. A following save therefore uses
the new baseline; an obsolete prompt cannot overwrite a different record or destination.

Explorer operations preserve unchanged source models and their clean baselines. Resource renames and
project XML edits pass through one validated transaction, retain file-operation undo state and keep the
original disk handles separate from unsaved structural changes. Type-associated file rename is enabled
only where this atomic resource host exists.

## Editor and workbench services

The editor factory supplies project-isolated semantic providers, direct project ownership for Fix All,
versioned workspace previews and actual test-provider CodeLens. Test runs enter the same Task Center as
build, analysis and native operations. The native operation bridge retains exact client/job identity
through cancellation and transport failures.

Language navigation uses the docking host for same-document and cross-document destinations. Preview
opens reuse the appropriate tab, successful destinations enter ordered history, and background opens
restore focus even when the destination operation fails. Source commands use the native editor command
registry, including smart actions, rename and the ReSharper-like IntelliJ scheme.

Object Browser and Code Definition share a bounded metadata catalog. Referenced PE bytes are captured
from the current disk/native backend, while parsing runs in the separately contributed metadata worker.
Metadata and runtime providers remain independent of source document text materialization.

Studio owns one disposal sequence for inputs, pending loads, saves, background tasks, test lenses,
navigation, tool hosts, editor integration, docking and services. Disposal continues through individual
cleanup errors and cancels pending work before the underlying document owner is destroyed.

## Qualification boundary

The source owners' completed-scope evidence is retained in their individual ledgers. The final host batch
includes real DocumentService, EditorModel, DiskWorkspace, ProjectSystem, TaskCenter and source-reader
contracts, including actual 200 MiB fixtures. Node fixtures are not evidence of browser permissions,
physical keyboard behavior, native application parity or a browser keystroke-to-paint measurement.

`scripts/project16-qualification.js` runs selected Node, browser and performance scopes serially. The
manual `project16-qualification.yml` workflow selects one operating system and browser engine per run,
captures the exact source SHA and uploads results even after failure. Browser performance includes the
actual 200 MiB scenario and an absolute 50 ms p95 target. A regression verdict requires a reviewed,
compatible baseline; capture-only runs do not manufacture a regression comparison.

At this source assembly commit, the final combined host qualification is pending. The aggregate
`project16-implementation.json` ledger records issue-specific limits and qualification status; it does
not automatically close issues whose platform acceptance has not been executed.


## Startup commands and captured reveals (SF-A19-T02 / SF-A19-T06.3)

The Project menu and solution context menu expose `solutionSetStartupProjects`
(the existing `startup-projects` action). The Debug menu exposes
`start-new-instance` and `stop-all`; a project context menu exposes
`projectDebugStartNewInstance`. An explicit project is passed through
`commands.invoke(id, { projectId })`, or as an object/string argument to
`commands.execute`. The new-instance action forwards that project to
`StudioExecution.startNewInstance` without modifying startup selection or either
project's selected launch profile. The Explorer Set as Startup Project route uses
`selectStudioStartupProject`, which preserves the same selected profile as the
toolbar. Native process execution remains unavailable and is explained by the
command's disabled reason.

`LaunchOrchestrator.start(options)` accepts the optional synchronous predicate
`shouldActivate(session)`. Its default returns true, preserving the existing
service behavior. When `activate` is true, the predicate runs after the first
application has launched, immediately before selecting it. Returning false keeps
the successfully launched application available without changing the selected
session; it does not cancel the application. The callback is removed from launch
overrides and is never sent to a worker. Studio supplies a predicate that checks
the captured user intent, selected project, and initiating session object so a
late launch cannot override a later selection.

`RevealPolicy.request(panelId, options)` checks `userInitiated`, the captured
`intent`, and optional project/session identities. `allows(options)` exposes the
same check without changing the UI. The optional synchronous `onReveal(panelId)`
callback groups source navigation and panel activation into one checked action.
Focus/activation caused by that callback does not count as new user navigation.
Deferred work must perform another request with the original captured intent
before changing the UI. Background builds never receive a reveal grant.

`StudioReveals` records user input in the main document and detached tools, and
records explicit programmatic navigation through Studio's open-file/panel routes.
The command registry's optional `onExecute(id, invocation)` callback runs before
an enabled, non-aborted command handler, allowing debug commands to capture a new
follow action. Launches and restarts bind that action to the application's worker
generation and launch epoch. Runtime events must additionally match the active
application's complete app/worker/runtime identity. Pause source navigation,
verified embedded-source navigation, completion/fault output, and initial
application-window activation all use this policy. Disposal removes input and
session subscriptions.

Focused regressions are authored in `tests/a19-startup-menus.test.js` (11),
`tests/a19-studio-reveal-policy.test.js` (14), and
`tests/a19-startup-project-profile.test.js` (3), using the small fake-worker fixture
`tests/support/studio-reveal-fixture.js`. They cover late completion, background
work, foreign/old identities, restart, cancellation, command availability, native
limitations, explicit project forwarding and profile preservation. These 28 cases
are pending the root agent's consolidated affected-scope validation; no new
browser or native qualification is claimed by this source handoff.

### Corrections from the consolidated host batch

The first affected-scope run at `4b1c0291` observed 302 passing and three failing
tests out of 305. Two failures belong to this shell follow-up. The reveal fixture
correctly requires input after document unload to leave the captured intent
unchanged. Registration and cleanup now share explicit capture options, avoiding
the host EventTarget's boolean-removal mismatch. The original intent assertion
remains, with additional keyboard and full-disposal checks.

The registry fixture's original 28 compiler / 46 runtime counts were stale.
`f8fb82ce` added ten editor requests; `3f1d57b8` added `resolveCodeAction`,
`outlineReorder`, and `validateWorkspaceEdit`; `1a4d8b8a` added runtime
`executionMetrics`. The fixture now records all 41 compiler and 47 runtime names
explicitly and retains exhaustive dispatch, duplicate, unknown-method,
malformed-parameter and disposal checks. No protocol declaration, handler,
request meaning, or automation lock changes in this correction. Its affected
rerun remains pending; these edits do not constitute a passing result.
