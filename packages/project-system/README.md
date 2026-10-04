# @sharpforge/project-system

`isProjectEvaluationInput(path)` identifies project, solution, imported XML, resource, editor-configuration,
SDK-selection, launch-profile, and workspace-manifest inputs that must be hydrated before initial evaluation.
Disk rescans use the same predicate as initial directory import, while ordinary source documents remain lazy.

MIT-licensed, dependency-free ES module for bounded project evaluation and build planning. It consumes caller-provided file records; it never fetches packages, reads host files or starts host processes. Portable targets run only through the explicit virtual task API.

```js
import { ProjectSystem } from '@sharpforge/project-system';
const system = new ProjectSystem([
  { path: 'App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>' },
  { path: 'Program.cs', text: 'Console.WriteLine(42);' }
]);
const snapshot = system.load('App.csproj');
if (snapshot.diagnostics.some(d => d.severity === 'error')) {
  throw new Error(snapshot.diagnostics.map(d => d.message).join('\n'));
}
const plan = system.buildPlan('App.csproj');
// Compile each dependency-ordered unit through a host that links its assembly references.
```

`ProjectSystem(records, options)` accepts `{path,text}`, `{path,bytes:Uint8Array}` and explicit metadata-only `{path,size,lazy:true}` records. Options include `configuration`, `platform`, `targetFramework`, and `maxFiles` (default 5,000). `load`, `snapshot`, `buildContexts` and `buildPlan` expose evaluation, diagnostics and independent assembly units. Public utility exports include `parseXml`, `xmlEscape`, `normalizePath`, `matchesGlob`, `evaluateCondition`, `createCsproj`, and `createSlnx`.

The portable model evaluates SDK defaults, ordered arbitrary item types, property functions, conditions, local imports, framework contexts, resources and project references. Selected-root files and supported virtual tasks remain bounded. Package restore, unresolved assembly references, Roslyn DLL analyzers and native-only tasks produce explicit diagnostics. The versioned feature boundary is in `src/evaluation/boundary.json`.

Provider-backed browser APIs: `readProviderFiles(FileList)`, `readProviderDirectory(directoryHandle, options)` and `ProviderDiskWorkspace(records, handles, name, folders, skipped, options)`. Legacy `readBrowserFiles`, `readDirectory` and `DiskWorkspace` retain their original eager/read-and-explicit-save behavior; the provider APIs are selected explicitly by new hosts (see [PROVIDER-DISK.md](./PROVIDER-DISK.md)). Directory-backed workspaces expose a provider and create new files on save. `save(changes)` checks exact byte hashes and all permissions before opening streams, rechecks after permission prompts, and reports partial writes on I/O failure. `create`, `delete`, `rename`, `move`, and `mutate` operate through the granted directory. Multi-file I/O is **not atomic** and cannot eliminate an OS-level race after preflight. File-input imports remain read/export-only; handles are never serialized into project JSON.

`disk.load(path, {signal, reload, beforeAdmit})` supports a synchronous host admission guard after byte, hash and handle
reads, before any cache or save-baseline publication. A thrown guard leaves the old entry intact; asynchronous guards
are rejected. Loaded records carry a monotonically increasing `version`. `disk.unload(path)` retains only path, size,
version and optional last-modified metadata, with the independent handle/hash still available for a later reload.
Studio's clean closed-editor lifecycle is documented in `apps/studio/WORKSPACE-DOCUMENTS.md`.

`writeNewDirectory(handle, plan, options)` retains the strict-empty save contract by default. Any existing entry rejects
the operation before mutation; a later I/O failure preserves completed files and reports `error.written` and their count.
The wizard explicitly passes `{mode:'merge', overwritePaths:[...]}` after `preflightDestination` and confirmation.
Merge mode preserves unrelated entries, requires exact overwrite paths, and attempts reverse-order rollback on failure
or cancellation. `error.rolledBack` and `error.leftovers` report whether recovery completed. Both modes validate the
complete portable path/byte plan and permissions before writing; neither promises cross-process atomicity.

Default disk budgets: 20,000 files, 48 levels, 2 MB per ordinary file, 64 MiB per assembly, and 128 MiB loaded bytes. Folders above 256 files enumerate metadata and load project/configuration inputs only; `{lazy:true}` always selects this policy. `disk.load(path)` hydrates one record and captures its byte hash; `disk.hydrate(paths)` prepares an explicit compile/export set. Unloaded records have `{path,size,lazy:true}` and no fabricated text. `workspace.skipped` and `importReport` explain non-portable names, collisions, ignored folders, and oversized files. Optional `applyGitignore:true` reads root rules. XML rejects DTD/external entities. See `packages/workspace/FILESYSTEM.md` and the focused A24 tests for the provider and scaling contracts.

The legacy `compilationFiles` and `compilationOptions` APIs retain source-combined preview behavior for existing callers. Per-source checked and language policies are retained, and conflicting policies for linked source files are rejected. New compilation hosts use `buildPlan` for separate binaries and metadata references.


### 0.7 local evaluation and native alternative

The portable evaluator supports bounded local imports/ImportGroup/Choose, final-property item conditions, ItemDefinitionGroup defaults, global-property immutability and numeric/version/Boolean conditions. Native package restore, Csc, Exec and custom task assemblies use the separate `@sharpforge/msbuild` package; its Node backend invokes installed MSBuild and its browser-safe entry supplies the client/contracts.

## 0.8 explorer helpers

Exports include `buildSolutionTree`, `validateItemPath`, `editProjectMembership`, `addSolutionProject`, `addSolutionFolder`, `removeSolutionProject`, `rewriteProjectPath` and `editNamedProjectItem`. These preserve unrelated XML and operate on supported literal path/item declarations. They do not reproduce native design-time MSBuild, wildcard/property-function path rewriting or arbitrary task semantics. Tree construction is separate from DOM controls in `@sharpforge/controls`.

## Portable evaluation and build planning

The evaluator now separates expression scanning, property/import evaluation, item definitions, ordered item operations,
SDK defaults, generated sources, resources and result construction. `evaluateCondition` tokenizes before expanding values;
quotes, parentheses and operators inside property values remain data. `expandExpression` uses the same bounded scanner
for property, item and metadata references. Unknown property-function members produce stable `MSB4xxx` diagnostics.

`ProjectSystem` accepts explicit `environment`, `clock`, `guid`, `sdkResolvers`, `caseSensitive`, `signal`, `limits`,
`projectProperties` and `launchProfile` options. It never reads process environment variables or the host filesystem.

`parseConfigurationJson(source, {maxLength, maxDepth, maxNodes})` parses JSONC configuration text, including comments,
trailing commas and a leading BOM. Defaults bound text to 1,000,000 UTF-16 code units, nesting to 64 and values to 100,000.
Invalid text throws `EvaluationError` with code `SFJSON001` and UTF-16 `start`, `length`, `line` and `column` locations.
Launch settings and native SDK configuration consumers share this parser.

### Framework contexts and selected build graphs

`runtimeFallbacks(rid, graph?)` expands RID imports in NuGet breadth-first order. The bundled graph contains all
85 portable RIDs from SDK 10.0.201, with its source hash exposed by `PORTABLE_RUNTIME_GRAPH_SOURCE`.
`readRuntimeGraph(runtimeJson)` loads a bounded custom graph, and `resolveRuntimeIdentifiers(properties, {graph})`
resolves the selected `RuntimeIdentifier` and declared `RuntimeIdentifiers` without choosing one implicitly.
Unknown RIDs report `NETSDK1083`; malformed or cyclic custom graphs throw `SFP1910`.
Each context exposes `runtimeFallbackChains`; pass an explicit `runtimeGraph` in `ProjectSystem` options to replace
the portable graph. Resolution has 20,000-node and 100,000-import limits and does not recurse on the call stack.

Each loaded project exposes independent `contexts[]` snapshots for `TargetFrameworks`, an `activeContextId`, and the
active snapshot's existing properties and items. Each context has `id`/`contextId`, `configuration`, `platform`,
`targetFramework`, `runtimeIdentifier`, and its own diagnostics. Context IDs use the shared
`projectContextId({project, configuration, platform, targetFramework, runtimeIdentifier})` contract. The native
MSBuild adapter can use the same `ProjectContextSelection` store; updating a project removes its stale contexts.

`system.getContext(project, selector?)` reads the active context or matches a stable ID or dimension object.
`system.selectContext(project, {targetFramework, runtimeIdentifier, configuration, platform})` re-evaluates the
workspace with that project's selected globals. It rebuilds context properties, items and diagnostics instead of
relabeling an old snapshot. The default framework-context limit is 32 per project.

`system.buildContexts(startup)` resolves the dependency graph using nearest compatible frameworks without reading
source contents. Hosts use its `compile[].path` and `references[].hintPath` values to hydrate lazy files before
calling `buildPlan`. A graph can contain two contexts of the same project; compilation units and reference edges
have `contextId` keys and the plan supplies `startupContextId`. The executable plan still refuses unloaded sources.
The UI-active framework of a dependency does not override the framework required by its consuming project.

`system.runTargets(project, targets, {contextId})` executes the exact selected context, including inactive dependency
contexts, and commits its generated items only after successful completion. `runOptions` and generated resource/source
records carry the context identity. A build includes diagnostics from its selected contexts; the workspace snapshot
retains labeled diagnostics from every framework.

`system.evaluationInputs()` returns the resource files and existing dependent source files needed for evaluation.
Calling it again after reading `.resx` discovers `ResXFileRef` inputs. It never fills unloaded records with empty text.
After hydration, call `load` to produce the final evaluated snapshot. `targetFrameworkDefines` exposes the bundled
SDK's framework symbols, and `DisableImplicitFrameworkDefines` suppresses them while retaining configuration defines.
Metadata-only workspace records must explicitly specify `{path, size, lazy:true}`. Membership can be evaluated from
these records, but source/resource content must be hydrated before compilation or resource emission.

Snapshots retain the previous `compile`, `references`, `packageReferences`, `items` and `imports` fields. New fields are:

- `evaluatedItems`: ordered item records by type, including custom types, identities, metadata and defining project.
- `generatedSources` / `generatedDocuments`: virtual global-usings and assembly-info C# sources.
- `resources`: manifest names, culture and deterministic `.resources` payloads for supported resx data.
- `allProjectReferences`: build dependencies including `ReferenceOutputAssembly=false` references.
- `targetGraph`, `importRecords`, `sdkImports`, `launchSettings` and `evaluationStatistics`.

```js
const snapshot = system.load('App/App.csproj');
const plan = system.buildPlan('App/App.csproj');
for (const unit of plan.units) {
  // Each unit contains its own sources, generated sources, compiler options,
  // resources and references to previously planned assembly outputs.
  // The host supplies compilation, metadata linking and runtime execution.
}
const run = system.runOptions('App/App.csproj', { profile: 'Development' });
// Pass run.args and run.environment to the selected runtime host.
```

`buildPlan()` keeps assemblies separate and records explicit friend-assembly grants. The legacy `compilationFiles()`
source-combined preview remains available for existing consumers. `compilationOptions()` forwards the compiler's real
`preprocessorSymbols`, `nullableContext`, `allowUnsafe`, warning policy, overflow and language-version options;
aliases such as `defines` are also retained for inspection.

`runTargets(project, targets, options)` explicitly executes the registered portable task subset against copied virtual
files. It returns `{success, project, contextId, executed, diagnostics, requiredFiles, files, changedFiles, outputBytes, applied}`. Set `apply:false`
for a preview. Successful runs apply virtual writes; failures preserve the input workspace. `maxSteps`, `maxDepth`,
`maxOutputBytes` and `signal` bound execution. Message, Warning, Error, PropertyGroup, ItemGroup, Copy, MakeDir,
WriteLinesToFile, ReadLinesFromFile, Touch, Delete, RemoveDir and CallTarget are registered. Native-only tasks are named
in blocking diagnostics. Native timestamp-driven incremental skipping is not emulated.

Copy, ReadLinesFromFile and appending WriteLinesToFile report unopened inputs in `requiredFiles`, also attached to
their located diagnostic. Hydration requests cannot be suppressed by ContinueOnError. Hosts load those paths into
`system.files` and retry the exact context with their own revision guard and retry limit; the failed run leaves no
partial virtual writes. Re-read `buildContexts` after successful targets to hydrate any newly added Compile paths.

SDK projects expose the logical `Build`, `BeforeBuild`, `CoreBuild`, `PrepareForBuild`, `ResolveReferences`,
`PrepareResources`, `Compile`, `BeforeCompile`, `CoreCompile`, `AfterCompile`, and `AfterBuild` stages. They anchor
registered portable targets; the stages do not pretend to perform native resolution or compiler tasks. Preparation
with `{phase:'beforeCompile', contextId}` stops at `CoreCompile` and returns `awaitingCompilation:true`. The host
then compiles the prepared unit and, only after successful compilation, supplies its actual assembly and optional
PDB/satellite bytes to the matching context:

```js
system.runTargets(project, undefined, {phase: 'beforeCompile', contextId});
const plan = system.buildPlan(startup);
// Compile the selected unit, retaining its exact context ID and output path.
system.runTargets(project, undefined, {phase: 'afterCompile', contextId,
  outputPath: unit.output, outputs: [{path: unit.output, bytes: artifact.assembly}]});
```

After-compile tasks see genuine compiler artifacts in their virtual filesystem. Empty or missing compiler outputs
are rejected with `SFP1803`; failed compilation must not resume the phase. Repeated preparation starts from the
initial evaluated properties/items, while retaining existing virtual output files. Each context keeps a separate
output snapshot, so two target frameworks can generate different source text at the same workspace path.
`system.buildFile(path,{contextId})` reads that context's output, including a deletion tombstone. Hydration through
`system.setBuildFile(path,record,{contextId})` updates a context's metadata-only record and the ordinary file index;
the supplied record must contain real text or bytes. Hosts must still guard asynchronous reads and compiler replies
against cancellation, workspace replacement, and newer builds.

`system.buildUnit(startup,contextId)` materializes a single prepared context, while preserving references to the same
dependency contexts as `buildPlan`. It never reads a later context's unopened or future generated sources. Unknown
context IDs, missing source text and unhydrated assembly inputs fail explicitly.

Studio's `requestProjectCompilation` prepares, compiles and finalizes each dependency context before preparing its
consumer. Each worker request contains one unit and `dependencyArtifacts` from the actual successful earlier compiler
results, keyed by context ID and explicitly marked `runtimeProfile:'sharpforge'`. The worker validates one shared
512-context budget and a 128 MiB dependency-assembly budget; a seeded artifact cannot masquerade as a newly compiled
startup unit. The existing `compileProjectPlan` handler performs the compilation and metadata linking. A failed
dependency compile or finalization prevents consumer preparation and source hydration. Cancellation, stale revisions
and superseded builds stop before subsequent target phases. Dependency graph changes after compilation are rejected
with a request to re-evaluate and retry.

Hosts that already prepare a full graph can pair `prepareProjectRequest` with `finalizeProjectBuild`; that explicit
pair runs all preparation before the full worker graph and all after phases after its return. The app's standard
`requestProjectCompilation` performs the per-context interleaving, including dependency-generated consumer inputs.
The app retains emitted sibling metadata
independently of later analysis results and invalidates it on dependency sources, options, resources, or context changes.
Folder mode hydrates all C# workspace members, with a 20,000-source, 2 MB-per-source and 64 MiB-text-memory budget,
without creating additional editor buffers. Arbitrary binary `.cs` contents are rejected rather than decoded as empty source.

`getCaseInsensitive(object,name)` reads an own property or item-metadata key, preferring an exact-spelling match;
absent keys and absent objects return `undefined`. Hosts use this same lookup for metadata such as reference aliases.

`createOutputLayout`, `readLaunchSettings`, `parseLaunchArguments`, `projectRunOptions`, `parseResx`, `writeResources`,
`readResources`, `parseTargetFramework`, `isTargetFrameworkCompatible` and `nearestTargetFramework` are independent
public APIs. Resource conversion never uses BinaryFormatter or executes user-supplied types.

The precise portable boundary is tracked in `src/evaluation/boundary.json`. SDK models cover common evaluation defaults;
Web/Razor/Worker/MSTest build toolchains, arbitrary .NET reflection, native restores and unsupported resource types
remain native operations. Run the focused `tests/project-evaluation-*.test.js` suites. The native differential suite
uses `SHARPFORGE_DOTNET` or `DOTNET_HOST_PATH`, or an installed `dotnet`, and records its reference SDK version.
## Prepared source record utilities

The public `cloneWorkspaceRecord(record, path)` utility copies property descriptors without reading a lazy `text` getter. It sets the record's path (and URI, if present) and keeps `model`, `source` and `originalSource` nonenumerable. It does not transfer model ownership or rebase a model/snapshot URI; callers changing a prepared source path must use their source contribution's rebase operation first.

`recordSource(record)` returns the contributed immutable source or `null` without reading text. `isSourceSnapshot(source)` recognizes a frozen object with a nonnegative safe-integer UTF-16 length and a `getText` method; it does not validate an editor model or its identity. `isTextRecord(record)` recognizes this source shape or a legacy string-valued `text` field. Prepared records take the source branch and leave their compatibility getter unread. Descriptor cloning preserves the input property contracts and throws for invalid descriptor inputs; consumers remain responsible for bounded path, source and ownership validation at their adoption boundary.

The Explorer snapshot tests exercise these exports through the package entry point, including exact immutable source identity, URI rebasing, hidden model metadata and history without full-source reads.

## Portable startup and launch-profile metadata

`validateWorkspaceSettings`, ZIP import/export, `workspaceManifestRecord` and extracted-folder import retain two registered data fields. `startupConfiguration` version 1 contains `mode` (`single`, `multiple`, `currentSelection`) and ordered entries `{projectId, action, order, profile}`. Actions are `none`, `start` or `startWithoutDebugging`. `launchProfiles` version 1 contains project entries `{projectId, selected, profiles}`; each profile retains only `{id, name, stopOnEntry, renderer, compute}`. Arguments, environment values, networking permissions and runtime grants are excluded even if an imported object contains them.

The public `sanitizeStartupConfiguration`, `sanitizeLaunchProfileMetadata` and `sanitizeSessionUserSettings` functions validate and copy these fields. Their optional context accepts `paths: Set<string>` for workspace paths or `projectIds: Set<string>` for loaded project identities. A project ID must be a portable relative path; `$workspace` identifies the loose-source workspace. Archive manifests require other project IDs to name included `.csproj` files. Workbench staging separately validates executable project kinds and profile references before replacing a workspace.

The exported `startupActions`, `startupModes`, `sessionUserSettingsLimits` and immutable `sessionUserSettingsContributions` table define this schema once. Limits are 1,024 projects, 64 profiles per project, 512 characters per profile ID, 200 per profile name and 4 MiB of compact metadata characters. Serialized workspace manifests also enforce the existing 4 MiB UTF-8 byte budget, including their other settings and indentation. Unknown fields are discarded; invalid versions, paths, duplicate IDs, selections or bounds throw before the import returns settings. Compute metadata is a preference, not a grant: the runtime validates whether its selected backend is supported.
