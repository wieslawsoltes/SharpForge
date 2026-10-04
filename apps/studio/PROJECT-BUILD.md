# Application project build sessions

`project-build.js` composes the public ProjectSystem, worker compilation and
native workspace-state contracts. Its caller supplies a session state with
`projectSystem`, `startupProject`, current editor `files`, `revision`, optional
`disk`/`workspaceEpoch`, native context fields and extension configuration.

- `hydrateProjectSources(state, {signal, contexts})` loads only the selected
  compilation inputs and local metadata references. It checks the workspace,
  disk, epoch, startup, revision and native-mode identities around each await.
- `projectCompilationFiles(state)` returns the startup compilation's own sources
  and generated documents with current editor overlays. Dependency source stays
  in its own project/context unit.
- `projectBuildErrors(state)` filters diagnostics to the selected context graph.
  Inactive contexts remain inspectable without blocking an unrelated build.
- `prepareProjectRequest(state, method, params)` builds a structured-clone-safe
  request. Native semantic requests use the explicitly selected native context.
  Portable builds prepare targets, hydrate requested inputs, preserve compiler
  options and references, and carry separate project/context build units.
- `requestProjectCompilation(state, compiler, method, params)` is the normal
  async delegate. Builds interleave each dependency context's pre-targets,
  genuine worker compilation and successful post-targets before its consumer.
  Find in Files can delegate directly to the disk index without compilation.
- `finalizeProjectBuild(state, request, result, {signal})` validates the attached
  session and exact successful context artifacts before post-compilation targets
  can consume PE/PDB/satellite bytes. Failure, cancellation, replacement or a
  superseding request prevents those target mutations.
- `projectLaunchOptions(state, options)` merges the selected browser launch
  profile's arguments/environment with explicit caller overrides. Executable
  profiles require the native host.
- `hydrateWorkspaceRecords` remains a compatibility reexport of the published
  `workspace-hydration.js`; export hydration has one implementation.

A session token guards the before/compile/after lifecycle. Context snapshots
preserve different generated text and tombstones for shared paths in multiple
TFMs. A failed compiler result never executes after-targets. Before-targets may
introduce new Compile inputs; bounded hydration retries materialize them before
worker submission. Dependency artifacts are validated and supplied as actual
assembly bytes to later contexts.

`project-artifacts.js` retains successful dependency metadata independently of
the latest analysis result. Source, compiler-option, resource, assembly-attribute,
reference and context changes invalidate affected cached artifacts. Failed
builds clear their former usable entries.

Folder mode compiles authoritative workspace membership plus editor overlays,
including closed C# documents. It does not create editor buffers for every input
or read unrelated binary assets. Limits are 20,000 sources, 2,000,000 text
characters per source and 64 MiB of accounted UTF-16 source text. Missing, binary,
oversized, cancelled or replaced lazy inputs are explicit failures.

The existing ten-case `a23-project-build.test.js` accompanies the complete
implementation. The following regression batch preserves the existing target
lifecycle/order, artifact-cache, real-folder and offline native comparison suites.
All 38 cases across the complete eight-file worker/build scope passed in the
scheduled Node26.10.0 Linux x64 cohort at `35f70db6`; its overall 21-file result
was 95 passed and one separate negative graph-fixture failure. The native oracle
used SDK10.0.401/MSBuild18.9.11.42413 and compared generated files and output with
SourceVM and CilVirtualMachine. Full argv, output and per-file evidence are in
the publication receipt. No separate local matrix was run for these projections.

These modules provide the callable session boundary. Protected Studio entry and
compiler-worker registration remain in the application integration batch; this
publication does not activate those host hooks or acquire disk permissions.

## Complete regression scope

The dependent regression batch preserves all existing assertions in:
`a23-project-build-order` (4), `a23-project-target-lifecycle` (9),
`a23-project-artifact-cache` (4), `a23-project-target-native` (1), and
`a24-folder-compilation` (4). These 22 cases passed within the same completed
38-case worker/build scope. The shared target-order fixture feeds both the
portable order tests and the real offline SDK comparison. Native qualification
uses an installed SDK when available and reports an explicit skip otherwise;
the recorded Linux x64 run executed it successfully.
