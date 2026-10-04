# @sharpforge/project-system

MIT-licensed, dependency-free ES module for bounded `.csproj` / `.slnx` loading. It consumes caller-provided file records; it never fetches packages or executes build code.

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
const sources = system.compilationFiles('App.csproj');
// Pass sources to @sharpforge/compiler. Project references are source-combined.
```

`ProjectSystem(records, options)` accepts `{path,text}` and `{path,bytes:Uint8Array}`. Options include `configuration`, `platform`, `targetFramework`, and `maxFiles` (default 5,000). `load`, `snapshot`, `closure`, and `compilationFiles` expose evaluation and diagnostics. Public utility exports include `parseXml`, `xmlEscape`, `normalizePath`, `matchesGlob`, `evaluateCondition`, `createCsproj`, and `createSlnx`.

SDK default Compile items; explicit Include/Exclude/Remove/Update and Link; property expansion; a documented condition subset; nearest Directory.Build.props/targets data; project reference ordering/cycles; solution folders and items are supported. The importer is not MSBuild. NuGet, binary references, Roslyn DLL analyzers, imports, tasks, resources and unsupported item types report diagnostics rather than executing silently.

Browser APIs: `readBrowserFiles(FileList)`, `readDirectory(directoryHandle)` and `DiskWorkspace(records, handles)`. `DiskWorkspace.save(changes)` requires explicit writable handles. It checks permissions and compares all baseline contents before opening streams, rechecks after permission prompts, and reports partial writes on I/O failure. It is **not atomic** across files, and cannot eliminate an OS-level race after preflight. File-input imports are read/export-only; handles are never serialized into project JSON.

Default disk budgets: 5,000 supported files, 20,000 directory entries, 48 levels, 2 MB per text file, 64 MiB per assembly, 128 MiB total. The Studio imposes a separate 100-source-file limit. XML rejects DTD/external entities; selected-root path escapes, duplicate file paths and malformed layouts are rejected. See the repository's `docs/project-system.md` and `tests/project-system.test.js`.

0.6: `compilationOptions(startupProject)` returns output kind and strict evaluated `CheckForOverflowUnderflow` defaults per source URI. Pass these with `compilationFiles` to the compiler. A linked file shared by projects with conflicting checked settings is rejected. References remain source-combined, not separate binaries.


### 0.7 local evaluation and native alternative

The portable evaluator adds bounded local imports/ImportGroup/Choose, final-property item conditions, ItemDefinitionGroup defaults, global-property immutability and numeric/version/Boolean conditions. It does not run tasks or packages. For authoritative native builds and raw disk project editing, use the separate `@sharpforge/msbuild` package; its Node backend invokes installed MSBuild and its browser-safe entry supplies the client/contracts. These are deliberately distinct modes.

## 0.8 explorer helpers

Exports include `buildSolutionTree`, `validateItemPath`, `editProjectMembership`, `addSolutionProject`, `addSolutionFolder`, `removeSolutionProject`, `rewriteProjectPath` and `editNamedProjectItem`. These preserve unrelated XML and operate on supported literal path/item declarations. They do not reproduce native design-time MSBuild, wildcard/property-function path rewriting or arbitrary task semantics. Tree construction is separate from DOM controls in `@sharpforge/controls`.

## Portable startup and launch-profile metadata

`validateWorkspaceSettings`, ZIP import/export, `workspaceManifestRecord` and extracted-folder import retain two registered data fields. `startupConfiguration` version 1 contains `mode` (`single`, `multiple`, `currentSelection`) and ordered entries `{projectId, action, order, profile}`. Actions are `none`, `start` or `startWithoutDebugging`. `launchProfiles` version 1 contains project entries `{projectId, selected, profiles}`; each profile retains only `{id, name, stopOnEntry, renderer, compute}`. Arguments, environment values, networking permissions and runtime grants are excluded even if an imported object contains them.

The public `sanitizeStartupConfiguration`, `sanitizeLaunchProfileMetadata` and `sanitizeSessionUserSettings` functions validate and copy these fields. Their optional context accepts `paths: Set<string>` for workspace paths or `projectIds: Set<string>` for loaded project identities. A project ID must be a portable relative path; `$workspace` identifies the loose-source workspace. Archive manifests require other project IDs to name included `.csproj` files. Workbench staging separately validates executable project kinds and profile references before replacing a workspace.

The exported `startupActions`, `startupModes`, `sessionUserSettingsLimits` and immutable `sessionUserSettingsContributions` table define this schema once. Limits are 1,024 projects, 64 profiles per project, 512 characters per profile ID, 200 per profile name and 4 MiB of compact metadata characters. Serialized workspace manifests also enforce the existing 4 MiB UTF-8 byte budget, including their other settings and indentation. Unknown fields are discarded; invalid versions, paths, duplicate IDs, selections or bounds throw before the import returns settings. Compute metadata is a preference, not a grant: the runtime validates whether its selected backend is supported.
