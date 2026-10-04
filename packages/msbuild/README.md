# @sharpforge/msbuild

The opt-in [native testing contribution](docs/test-native-adapter.md) exposes
trusted discovery, cancellable run sessions, reports and retained artifacts.

Native test discovery, TRX/Cobertura parsing and runner argument contracts are
documented in [docs/test-native-formats.md](docs/test-native-formats.md).

[Portable test declaration records](docs/test-symbols.md) expose a lazy lossless
syntax frontend for framework adapters without executing user source.

Browser-safe MSBuild contracts/client and a separately imported Node native backend. MIT, ES modules, Node 22+ for native APIs. The native engine invokes an installed SDK or MSBuild executable; .NET is not bundled.

The public native process and host trust APIs are documented in [native-process.md](docs/native-process.md).

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

The adapter provides build/rebuild/clean/restore/pack/publish/VSTest/custom target jobs; authoritative property/item queries, target results/preprocessing/listing; cursor-based logs/diagnostics, cancellation/timeouts/output limits; hash-checked text saves, existing encoding preservation and bounded artifact discovery. Solution inspection and configuration mapping do not execute projects or targets.

`MSBuildClient.fromLocation()` consumes and clears a session token fragment. Client URLs must use the same origin as the served IDE. The host does not enable cross-origin access. A standalone installed package needs `--studio` pointing to the separately delivered browser distribution.

The 0.7 source distribution includes `docs/msbuild.md` for the complete startup/API/trust/limits contract, four example groups and a separate real-SDK validation gate. Node transport tests use an explicit child-process simulator, not Microsoft MSBuild. Native SDK execution was not qualified in the release container because no SDK was installed.

A default job times out after 30 minutes; default captured output is 32 MiB and retained records are 32. Logs are retained on disk in `.sharpforge/msbuild/` and require owner cleanup after stopping the host. Native tasks can consume resources beyond these adapter limits.

## 0.8 disk explorer API

`MSBuildClient.inspectItem`, `mutate` and `undoMutation` use the authenticated host's file-operation routes. The Node `NativeWorkspace` exposes the same bounded create/mkdir/move/copy/delete/write machinery with SHA-256 snapshots and quarantined undo. Binary reads support managed assembly inspection without source replacement. Read docs/explorer-keymaps.md before embedding: batches are not atomic, conflicts/partial completions are reported, undo receipts are in-memory and quarantined content is not automatically purged. File editing is distinct from native build trust.

## Evaluation comparison

The public comparison/reporting APIs and bounded native corpus are documented in [DIFFERENTIAL.md](DIFFERENTIAL.md).
[Managed test preparation](docs/test-runtime.md) compiles prepared declarations into
an isolated source or CIL session and retains explicit unsupported-test diagnostics.

## Shared test records and run sessions

The public package entry exports `createTestCase`, `testCaseId`, `createTestResult`,
`TestOutcome`, `TEST_MODEL_VERSION`, `createTestTree`, `defineTestAdapter` and
`TestRunSession`. Providers share stable discovery identity, explicit results and
cancellable progress while retaining separate execution capabilities. See
[the test protocol](docs/test-model.md) for fields, bounds, ownership and lifecycle.

[Portable framework discovery](docs/test-discovery.md) describes the xUnit, NUnit
and MSTest adapter registry, data evaluation controls and explicit boundaries.

[Portable test sessions](docs/portable-testing.md) execute the managed framework
profile with isolated fixtures, cancellation, explicit outcomes and replayable progress.

## Solution configuration API

The package entry exports the following pure model APIs. Paths use normalized
workspace-relative spelling. These helpers perform no native project evaluation.

```js
import {readSlnxConfigurations, selectSolutionProjects,
  solutionProjectBuildRequest, writeLegacySolution} from '@sharpforge/msbuild';

const solution = readSlnxConfigurations(text, {path: 'Workspace.slnx'});
const selection = selectSolutionProjects(solution,
  {configuration: 'Release', platform: 'Any CPU', action: 'build'});
const request = solutionProjectBuildRequest(solution,
  {project: 'App/App.csproj', configuration: 'Release', platform: 'Any CPU'});
const classicText = writeLegacySolution(solution);
```

`readSlnxConfigurations(source, {path, maxProjects = 10000, signal})` returns
`{path, format, configurations, projects, folders, files, projectTypes, diagnostics}`.
Each configuration has a name, configuration and platform. Project records retain
unknown XML attributes/properties, dependencies and unsupported project entries.
CLR projects default to AnyCPU; VC maps Any CPU to x64 and x86 to Win32. Build type,
platform, build and deploy rules use declaration order, with the last matching rule
winning after inherited project-type defaults. Missing configurations default to
Debug/Release and Any CPU. Unsupported projects remain visible and unloaded.

`readSlnConfigurations(source, {path, signal})` reads the same configuration model
from classic solutions using the public legacy reader. ActiveCfg, Build.0 and
Deploy.0 are independent; an active configuration alone does not opt into a build.
Both readers reject duplicate configurations and cap the resulting dimension
product at 4096 configurations. SLNX additionally caps input at 4 million characters
and 100000 XML nodes; cancellation is checked before and during project traversal.

`selectSolutionProjects(model, {configuration, platform, action, projectPath, signal})`
returns `{configuration, platform, projects, projectProperties}`. Per-project rows
include mapped globals and a selected flag. Actions are build, rebuild, clean,
deploy and evaluate. Unknown selections and project membership fail explicitly.
`createSolutionConfigurationManager(model, options)` adds a copied configuration
list and includes every row, including projects excluded from a solution build.
`mapSlnxProject(project, selected)` returns one project's mapped dimensions/flags.

`solutionProjectBuildRequest(model, request)` maps a single project even if its
solution Build flag is disabled. It retains the solution selection separately as
`solutionConfiguration` and `solutionPlatform`, so repeated mapping is idempotent.
`resolveSolutionBuildRequest(workspace, request, {signal})` reads `request.solution`
through `workspace.read(path)` and applies that mapping. The caller must authorize
workspace access first; native scheduling and trust remain outside this helper.
Direct solution builds and requests without a solution context pass through.

`writeLegacySolution(model, {path, newline = '\r\n', bom = false, signal})` emits
classic solution text, retaining existing GUIDs, project/folder relationships,
dependencies, unknown project/global sections and explicit build/deploy selections.
New GUIDs are deterministic; `solutionEntryId(identity)` is a stable display identity,
not a cryptographic identity. Unknown project types require an explicit type GUID.
It rejects duplicate GUIDs, missing dependencies, invalid quoted values/newlines,
more than 10000 projects or more than 4096 configurations. This serializer preserves
structured meaning; source whitespace/comments and arbitrary original bytes are not
round-tripped by it. Source-preserving XML edits are a separate API.

`inspectSlnx(text, {path})` retains its structural result and adds
`configurationModel`; `createWorkspaceSlnx(path, projectPaths)` retains relative
project linking. `SolutionDimension`, `canonicalSolutionPlatform`,
`inferProjectConfiguration`, `solutionConfigurationName` and
`splitSolutionConfiguration` expose the same model's comparison/default rules.
Dimension names reject control characters, pipes, empty values and lengths over 256.
