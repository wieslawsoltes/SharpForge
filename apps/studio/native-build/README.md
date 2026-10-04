# Native context, profile and test tools

`MSBuildTools` retains its existing exported class and native build, save, open,
inspection, cancellation, artifact and automation contracts. Its former dense
implementation is now a one-line facade over the controller and independent
views. Native operations share the existing workspace trust and save gates.

## Semantic contexts

The Project language context section selects a workspace project and explicitly
loads its native design-time contexts. Selecting an evaluated context hydrates
the exact source set and obtains reference bytes from `project/metadata`; the
host authorizes those reference paths against its authoritative design-time
result. The browser validates context identity, count/byte bounds and SHA-256
when supplied, and decodes large metadata records in yielding chunks. Generated
sources are read-only. Read or metadata failure leaves the preceding context
active. Sources outside the workspace grant cannot be loaded: open a containing
workspace before using that complete context.

`createNativeContextHooks(host)` supplies the application `onProjectContext`,
`getTestInput` and `getTestSources` callbacks. It composes `applyNativeProjectContext` with editor
reset, workspace rendering and language analysis scheduling. The application
compiler-request helper consumes `nativeCompilationRequest(state)`, which
contains exact files and metadata-backed compilation options; files merely
opened outside that context do not enter its semantic model. The per-document
editor guard is `nativeDocumentReadOnly(state, file)`.

Native references enable supported metadata-backed language binding. Loading
them does not add a native CLR execution backend or broaden the portable
external-call emission/runtime profile. Native analyzer DLL execution also
remains owned by the native build; the context preserves analyzer inputs.

## Profiles

Read launch and publish profiles performs file inspection only, without target
execution or requiring execution trust. Launch settings retain JSONC diagnostics.
The selected Project launch profile produces an explicit request with profile,
arguments, environment, application URL, working directory, framework and
configuration. The native host performs the actual profile launch. Executable
profiles use the host's granted-workspace process adapter: executable and working
directory paths resolve relative to the project, and outside-grant executables
are rejected by the host before process creation.

Publish profile listing preserves literal properties and marks values requiring
native evaluation. Selecting a profile never publishes. Publish selected profile
calls `publish/execute`, then uses the normal job/log/artifact lifecycle.

## Test Explorer

The dockable `tests` tool supports native VSTest, native Microsoft.Testing.Platform
and bridge modes, plus portable source and CIL execution. Portable discovery and
execution use a lazily created module worker with owned managed sessions,
cancellation and a hard worker-stop fallback. The worker retains the discovery
payload; only test model records and results cross into the UI. Changed source
requires discovery again.

The application may supply an asynchronous `getTestInput({signal})` callback
returning a prepared `{files, compilationOptions, contextId, revision}` request.
This keeps lazily hydrated project sources, conditional symbols and reference
images together. Discovery, computed data providers and run compilation use the
same options; the managed harness owns its entry point and executable output
kind. A changed context/revision requires discovery again.

Native start/poll/cancel services retain parsed TRX results, progress, debugger
PID handoff, artifacts and coverage. Native source scanning, when source text is
available, enriches locations and stable identifiers through `sourceTests`.
VSTest's implemented filter selects methods, so selecting any theory row selects
every discovered row of that method; the UI explains this boundary. MTP preserves
native UIDs for row selection. No console text is promoted to a passing result.

Test results expose pass/fail/skip/not-run/not-runnable/cancelled/timed-out states,
messages, output and source navigation. Coverage is rendered in bounded tables;
complete reports remain downloadable. Native framework qualification requires
the pinned framework/adapter packages and is independent of mocked UI transport
coverage. A controller test is not a browser or native host qualification result.

This projection composes the complete controller with the published context, profile,
view and testing modules. Application tool registration and the protected Studio entry
are separate dependent integration steps.


## Native operation ownership

Build jobs use the workbench's existing `native-operation` lifecycle. Accepted job
snapshots retain their actual client owner. `onJob(snapshot, {owner, cancel,
selected})` exposes a cancellation callback bound to that job and owner; a late
reply for a background job does not replace the selected job. Observed transport
failures call `onJobFailure(jobId, error, {owner})`.

`dispose()` is idempotent and returns a promise. It marks the controller disposed,
closes its test sessions, cancels captured native operations and releases client
credentials after their cancellation work settles. Existing profile and Test
Explorer operations retain their own bounded abort paths. The native context,
profile and source APIs remain available through the same `MSBuildTools` facade.
