> **0.7 native alternative:** Use [the local MSBuild backend](msbuild.md) for authoritative SDK/import/task/package semantics and separate assemblies. This document describes only the portable browser preview. The new backend does not change this preview into full MSBuild.

**0.8 update:** See [Explorer, menus, editor profiles and breakpoint workflows](explorer-keymaps.md) and [current validation](validation-0.8.0.md). Earlier feature sections below remain applicable within their stated limits.

# Disk projects and solutions — 0.6.0

## Opening a workspace

**File → Open folder** uses the File System Access directory picker when available; otherwise it opens a directory file input. **File → Open project or source files** accepts `.csproj`, `.slnx`, `.cs`, `.props`, `.targets`, JSON and managed assemblies. A single project file cannot grant access to unselected siblings: choose its containing folder or select every needed file. A folder import chooses the first `.slnx` path, otherwise the first `.csproj`; Project Properties lets you select another loaded entry and startup project.

The default startup project is the first executable project, then a solution root project. Solution Explorer displays project groups, compile files and selected binaries. Configuration can switch between Debug and Release. Both are evaluated property values; this does **not** choose a full MSBuild toolset, optimizer or framework runtime.

The previous source workspace is staged for recovery before a successful replacement. Malformed input and the 100-source-file Studio cap fail before replacement. Project evaluation errors stay visible and block emission in the affected active project/reference closure. Source editing is supported; renaming/deleting/adding compile membership for imported projects is deliberately left to the project files on disk followed by reopen.

## Supported evaluation

| Input | Implemented behavior |
| --- | --- |
| `.slnx` | Solution root, Project paths, nested Folder names and File items; project paths relative to the solution directory |
| SDK `.csproj` | Implicit recursive `.cs` compile set; hidden/bin/obj exclusion; EnableDefaultItems / EnableDefaultCompileItems |
| Compile items | Include, Exclude, Remove, Update; semicolon lists; `*`, `?`, `**`; Link display metadata; duplicates/missing files diagnosed |
| Properties | Case-insensitive `$(Property)` expansion and explicit global Configuration/Platform; nearest Directory.Build.props before and targets after project data |
| Conditions | Quoted == / != comparisons, true/false, And/Or/!, parentheses, Exists and HasTrailingSlash; unsupported grammar produces an error |
| ProjectReference | Dependency-first ordering, closure, missing-reference/cycle diagnostics; ReferenceOutputAssembly=false is not a source dependency |
| AdditionalFiles | Recorded and visible; JavaScript extensions must be enabled explicitly |
| Library target | No Main needed; no executable CLI entry token; emitted static `.cctor` initializes supported static fields on direct-CIL invocation |
| Unsupported dependencies | PackageReference, binary Reference, Roslyn Analyzer DLLs, Import, Target/task code and emitted resources do not execute/restore/link; diagnostics block affected builds |

**ProjectReference is a source-combined preview, not separate project compilation and binary linking.** Internals/accessibility, duplicate names, target frameworks, compilation symbols and assembly boundaries do not acquire full MSBuild/.NET semantics. TargetFramework values are loaded metadata; the browser runtime remains its own explicit profile. Unknown non-executable properties can be retained without implemented behavior; do not assume every property influences compilation. Directory.Build item/property ordering implements the documented local subset, not every MSBuild evaluation phase. No `.sln` legacy parser is included.

## Saving and safety

**File → Save changed sources to disk** (Ctrl+Alt+S) is the only write path. It requires a folder opened with native handles and browser read/write permission. All requested source files are compared with their loaded baseline, then permission is checked/requested and contents rechecked before any stream is opened. Conflicts abort without writing. I/O failure after earlier writes reports which paths already changed. There is no atomic multi-file transaction or external-file watch; an external race after preflight is still possible. Project XML and binary files are never implicitly overwritten.

File-input imports and recovered workspaces have no writable handles. Export the project JSON or source/project XML instead. Local storage recovery is best-effort and does not restore native permissions or binary file bytes. Loading/inspecting a DLL does not execute it. XML rejects DTDs and external entities; references outside the selected root, malformed XML and file budgets are enforced. This is not independent security qualification.

## CLI

```sh
node apps/cli/main.js project-info examples/projects/Workshop/Workshop.slnx
node apps/cli/main.js run examples/projects/Workshop/Workshop.slnx
node apps/cli/main.js check examples/projects/Configurations/Configurations.csproj --configuration Release
node apps/cli/main.js compile examples/projects/Library/Library.csproj -o library.dll
node apps/cli/main.js run examples/projects/Library/Library.csproj --method Arithmetic::Add --args '[1,1]'
```

`--project` is a startup project path relative to the selected disk root. `--root` defaults to the entry file's directory; supply the solution's parent directory when opening a project that refers to sibling directories. The bounded CLI reader skips symlinks; it does not establish an OS security sandbox against filesystem races. `--target library` also supports loose `.cs` inputs. Library output does not emit a runtimeconfig file; invocation uses a selected static method.

## Examples and references

`examples/projects` contains Workshop, Linked, Configurations, Library, Generated and intentionally Unsupported workspaces. `examples/coverage.json` is consumed by regression tests. The Generated example requires explicitly enabling the schema generator; the Unsupported example must emit SFP1102.

Primary format references consulted: Microsoft [.NET SDK MSBuild properties](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props), [common MSBuild project items](https://learn.microsoft.com/en-us/visualstudio/msbuild/common-msbuild-project-items), and [.slnx CLI introduction](https://devblogs.microsoft.com/dotnet/introducing-slnx-support-dotnet-cli/). Browser references: MDN [showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker) and [createWritable](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable). These describe the host formats/APIs; they are not claims that this importer implements those products in full.

## Checked arithmetic defaults

Use `ProjectSystem.compilationOptions(startupProject)` with `compilationFiles(startupProject)`. `CheckForOverflowUnderflow` accepts true/false and defaults false; Studio and CLI propagate per-project values into source-combined dependencies. Explicit lexical checked/unchecked contexts override the project default. Conflicting defaults for one linked file in multiple active projects fail rather than choosing arbitrarily. `--checked` is a loose-source CLI option, not a project override.


## Portable evaluation additions in 0.7

Local Import and ImportGroup (including sorted wildcard imports), nested Choose/When/Otherwise, imported-file intrinsic properties, item definitions/default metadata, global-property immutability, numeric/hex/four-part-version comparisons, Boolean conditions, Exists and HasTrailingSlash are implemented within bounds. Property evaluation precedes final-property item conditions. Imports are limited to supplied workspace files, 64 nesting levels and 256 imported files; cycles/duplicates and unavailable imports are diagnosed.

The browser does not execute .NET property functions, SDK resolvers, target bodies, arbitrary item transforms/batching, native tasks, package restoration or compiler DLL extensions. Target/UsingTask/package inputs still produce explicit native-backend diagnostics. MSBuild's complete evaluation and target semantics belong to the installed native engine described separately. Static SLNX structure inspection retains mappings as data; the native engine decides their meaning.
