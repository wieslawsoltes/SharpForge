# @sharpforge/msbuild

Browser-safe MSBuild contracts/client and a separately imported Node native backend. MIT, ES modules, Node 22+ for native APIs. The native engine invokes an installed SDK or MSBuild executable; .NET is not bundled.

```js
// Browser-safe imports: no fs/process/child_process dependency.
import { MSBuildClient, normalizeBuildRequest, inspectSlnx } from '@sharpforge/msbuild';
// Node-only backend:
import { NativeWorkspace, NativeMSBuild, startMSBuildHost } from '@sharpforge/msbuild/node';
```

```sh
sharpforge-msbuild serve --root /path/to/workspace --studio /path/to/browser-dist --trust-projects
sharpforge-msbuild build App/App.csproj --root /path/to/workspace --trust-projects --restore
sharpforge-msbuild evaluate App/App.csproj --root /path/to/workspace --trust-projects --json
```

Open the host's printed token URL. Native calls require both host permission and per-request `trusted:true`. Do not enable this for untrusted project inputs. Property functions, SDKs, imports, tasks, packages and analyzers can execute with your OS permissions; this is **not a sandbox**. API file boundaries do not restrict native task execution. Never expose the loopback service publicly.

The adapter provides build/rebuild/clean/restore/pack/publish/VSTest/custom target jobs; authoritative property/item queries, target results/preprocessing/listing; cursor-based logs/diagnostics, cancellation/timeouts/output limits; hash-checked text saves, existing encoding preservation and bounded artifact discovery. `.slnx` structure inspection is data-only, not an evaluator.

`MSBuildClient.fromLocation()` consumes and clears a session token fragment. Client URLs must use the same origin as the served IDE. The host does not enable cross-origin access. A standalone installed package needs `--studio` pointing to the separately delivered browser distribution.

The 0.7 source distribution includes `docs/msbuild.md` for the complete startup/API/trust/limits contract, four example groups and a separate real-SDK validation gate. Node transport tests use an explicit child-process simulator, not Microsoft MSBuild. Native SDK execution was not qualified in the release container because no SDK was installed.

A default job times out after 30 minutes; default captured output is 32 MiB and retained records are 32. Logs are retained on disk in `.sharpforge/msbuild/` and require owner cleanup after stopping the host. Native tasks can consume resources beyond these adapter limits.

## 0.8 disk explorer API

`MSBuildClient.inspectItem`, `mutate` and `undoMutation` use the authenticated host's file-operation routes. The Node `NativeWorkspace` exposes the same bounded create/mkdir/move/copy/delete/write machinery with SHA-256 snapshots and quarantined undo. Binary reads support managed assembly inspection without source replacement. Read docs/explorer-keymaps.md before embedding: batches are not atomic, conflicts/partial completions are reported, undo receipts are in-memory and quarantined content is not automatically purged. File editing is distinct from native build trust.

## Cancellable reads

`client.read(path, {signal})` returns the existing file response containing
`path`, `text`, `encoding`, `bom`, SHA-256 `hash`, and byte `size`.
`client.binary(path, {signal})` returns a `Uint8Array` through the existing
managed-assembly endpoint. Both forward an optional AbortSignal to the
authenticated request; calls without an options object retain their behavior.
Owners must still reject results from replaced document/workspace/client
instances. Read cancellation does not start or cancel a native build job.

`tests/a19-native-disk-observer.test.js` covers signal forwarding and actual
temporary-file native reload/hash/save round trips. Its filesystem cases do
not invoke or qualify an installed MSBuild SDK.

## Native project services

The bridge now exposes queued native jobs and an explicit service registry. User builds have priority over design-time requests. Queued design-time evaluations with the same project and global properties are superseded; a running request is cancelled through its job ID. The process runner inherits an allowlist of tool-discovery environment variables, never host tokens or startup hooks. Response files are recursively checked; external logger/toolset switches require both request and host elevated trust. Output property overrides must be literal paths inside the workspace.

```js
import { MSBuildClient } from '@sharpforge/msbuild';
const client = MSBuildClient.fromLocation();
const toolchains = await client.sdkInventory();
const { context, cached } = await client.projectContext({
  project: 'App/App.csproj', configuration: 'Debug', framework: 'net10.0', trusted: true
});
const profiles = await client.publishProfiles({ project: 'App/App.csproj' });
const publish = await client.publishProfile({ project: 'App/App.csproj', profile: 'Folder', trusted: true });
```

`ProjectContext` keeps source/generated documents, reference paths and aliases, defines, language/nullability/unsafe/checked options, analyzers, additional files, editorconfig inputs, import identities and context-tagged diagnostics/artifacts. Native SDK design time uses `Compile` with `DesignTimeBuild`, `SkipCompilerExecution` and `ProvideCommandLineArgs`; CPS projects may explicitly select the CPS design-time target set. No compiler DLL is emitted by that design-time request. The cache hashes `MSBuildAllProjects` inputs and global properties, with a bounded reverse dependency index.

`projectContextCompilationInput(context, sourceRecords)` maps either backend's context into hydrated source records
and canonical compiler options for `Workspace`. It preserves read-only generated-document flags and reports
`SFMSB_CONTEXT_SOURCE_MISSING` if a source has not been loaded. `projectContextCompilationOptions(context)` exposes
the same option mapping independently. Native reference paths remain separate so the caller can supply its explicit
metadata loading policy; a context does not grant filesystem access to SDK assemblies.

`client.projectMetadata(request, {signal})` explicitly authorizes a design-time context and reads only its selected reference paths.
The response is `{contextId, references, totalBytes}`; each reference includes `path`, `display`, `aliases`, `base64`, `sha256`, `size`
and a validated assembly `identity`. Omit `request.references` to load the context's complete reference set, or provide an exact path subset.
The native host admits at most 512 references, 8 MiB per file and 32 MiB total by default. Unknown reference paths, invalid metadata and
concurrent changes produce explicit errors. The browser must verify the returned context identity before applying the references to its
language workspace. No assembly is executed while reading metadata.

`NativeBuildService` provides an opt-in fast check for callers that supply complete input/output sets. It skips a native process only after a successful baseline with matching content, timestamps and global properties. Projects with arbitrary side-effecting targets should continue through native MSBuild. `ProjectBuildGraph` maps changed inputs to independent project contexts and their transitive dependents. Affected graph builds invoke the SDK in dependency order with `BuildProjectReferences=false`, so unaffected dependencies are not rebuilt implicitly.

### Packages and SDKs

`client.packageOperation(operation, request)` supports configuration, assets, lock, restore, change, consolidate, query, search, versions, nuspec and vulnerabilities. Package edits use the project system's source-preserving edit API, preflight file hashes, then native restore. A failed restore retains the explicit source edits. Multi-project consolidation reports each operation; it is not an atomic multi-project transaction.

NuGet.Config hierarchy inspection applies clear/remove/add precedence, source mappings and disabled feeds. Credential values are never returned. V3 resources have explicit origin grants, bounded responses and caches; credential providers are accepted only by the native host. `project.assets.json` remains the authority for transitive restore decisions. The package reader separates compile reference assets from runtime/RID assets and accepts a target-framework compatibility reducer from the project system. Conditioned central-package declarations require evaluated project items.

SDK inventory preserves installed versions/paths/previews, runtimes and host RID. SDK selection implements all nine `global.json` roll-forward policies and prerelease filtering. Workload preflight reports missing workload commands; it never installs a workload implicitly.

`client.runProject(request)` accepts the public project system's resolved `runOptions`, or reads the selected saved profile when omitted.
Project profiles run through `dotnet run` with explicit arguments, bounded profile environment and `RunWorkingDirectory` inside the granted
workspace. This also applies working-directory values on SDK versions that ignore that launchSettings field. An empty working directory uses
the project directory. Application variables overlay the restricted host environment; unrequested host secrets and startup hooks remain absent.
`request.arguments` and `request.workingDirectory` explicitly override those profile values. `noLaunchProfile:true` bypasses saved profiles.
Located JSON errors remain available as `error.diagnostics` across the HTTP client. Executable profiles use the same trusted queue,
environment and process-tree termination policy, selecting a regular non-symlink executable inside the granted workspace. Relative
executable paths resolve from the project directory; arbitrary host paths and PATH-based command lookup are rejected. The executable must
already exist and be runnable on the host platform. IISExpress and other profile kinds require a separate host adapter and report
`SFMSB_LAUNCH_ADAPTER` when supplied directly to the native launch service.

### Structured diagnostics and binary logs

SARIF 2.1 diagnostics retain suppression state, help links and related locations. Text diagnostics preserve compiler/MSBuild/NuGet/NETSDK codes and multiline details.

The native binary-log reader compiles a small helper against the installed SDK's `Microsoft.Build` assemblies. It uses the official `BinaryLogReplayEventSource`, including forward-compatible event handling, instead of duplicating its version-specific binary schema. The helper spools bounded NDJSON; JavaScript indexes only structural project/target/task nodes. `/jobs/{id}/binlog` returns event pages/search, tree pages or timing tables. Event cursors are byte offsets into the spool, so later pages do not rescan earlier events. Parallel task durations can overlap and are not presented as additive build wall time.

Defaults: 512 MiB input, 1 GiB event spool, 100,000 structural nodes with a conservative 32 MiB storage budget, 4 MiB event records,
1,000 records and 8 MiB of record payload per response, and at most 50,000 scanned records per search page. Byte-limited pages preserve
the cursor of the first unreturned record. The helper enforces a 512 MiB working-set ceiling at event callbacks and reports its measured
peak and actual reader file/product versions. The optional large-log qualifier checks an independent 512 MiB Node RSS budget and a
conservative combined 1 GiB budget. These are resource guards and explicitly measured platform evidence, not an all-platform claim.
Binary logs can contain project data and are exposed only through the authenticated loopback session.

Run the completed-scope memory qualification with
`SHARPFORGE_LARGE_BINLOG=1 SHARPFORGE_DOTNET=/absolute/path/to/dotnet node scripts/limited.js node --test tests/a23-native-binlog-large.test.js`.
It generates a deterministic large binary log through the SDK's official logger, validates its physical compressed size, and records
native-helper/Node peak RSS and paging time. The fixture uses high-entropy Unicode messages and is not a workload-speed benchmark.

### Trust, shutdown and qualification

`WorkspaceTrustStore` persists grants keyed by the canonical root hash in a host-selected file. CLI `--trust-store PATH --trust-projects` records a grant; API `grant`/`revoke` is explicit. The trust file should reside outside project-controlled content. Node reuse and compiler servers are opt-in (`--node-reuse`, `--compiler-server`); enabled servers are shut down on host close.

Run the real SDK qualification matrix after completing a work batch:

```sh
SHARPFORGE_DOTNET=/absolute/path/to/dotnet node packages/msbuild/qualification/run.js /tmp/native-report.json
SHARPFORGE_DOTNET=/absolute/path/to/dotnet node scripts/limited.js node --test tests/a23-native-*.test.js
```

The runner creates isolated SDK-pinned fixture workspaces and checks restore/build/pack/publish success and `SFQA1001` failures, plus both solution formats with/without graph builds. The report records installed SDKs, exact invocations, paths, artifacts and timings. Other operating systems and missing stable/preview selections are explicitly skipped. Transport fixtures, native Linux runs, Windows process-tree qualification and macOS qualification remain separate evidence categories.

Project 18's completed native scope records exact commands, source commits and qualification gaps in
[`planning/evidence/project18/native.json`](../../planning/evidence/project18/native.json).
The real compiler-input qualifier retains ten independently configured SDK command lines and expected option objects;
set `SHARPFORGE_CSC_CORPUS` to write its JSON report. The reusable-worker qualifier measures actual builds and live worker
cleanup only when the host permits native named-pipe IPC. A denied worker socket is retained as unavailable qualification,
with no speedup or cleanup claim. `SHARPFORGE_REUSE_REPORT` writes measurements only after those checks succeed.

Reference contracts: [global.json](https://learn.microsoft.com/dotnet/core/tools/global-json), [MSBuild binary-log API](https://github.com/dotnet/msbuild/blob/main/documentation/wiki/Binary-Log.md), [NuGet V3 API](https://learn.microsoft.com/nuget/api/overview), and [NuGet versioning](https://learn.microsoft.com/nuget/concepts/package-versioning).

Installed SDK and platform evidence is reproducible with the [native qualification runner](docs/native-qualification.md).
