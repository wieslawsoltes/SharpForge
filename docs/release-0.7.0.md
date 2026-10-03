# SharpForge 0.7.0 — native MSBuild and IDE project tools

October 2, 2026 · Updated from the uploaded 0.6.0 source

## What this release implements

SharpForge now integrates an installed native MSBuild engine with its browser IDE. A new independently packaged `@sharpforge/msbuild` library supplies a browser-safe client, request contracts and SLNX structural helpers, plus a Node-only workspace API, process engine, authenticated loopback host and `sharpforge-msbuild` executable. There are now **16 reusable packages**.

**This is native MSBuild integration, not a complete JavaScript reimplementation or an embedded .NET SDK.** Native evaluation and execution are delegated to `dotnet msbuild` or an explicitly selected standalone MSBuild installation. Imports, SDK resolution, property functions, item transforms/metadata/batching, targets, tasks, separate project references, Roslyn extensions, NuGet and workload behavior therefore come from that installation. Required SDKs, task assemblies, packages, credentials and platform components must be available locally. The portable browser compiler remains a separate, bounded preview engine.

**Qualification notice:** all local regression, transport, browser-harness and package tests described below passed. This environment has no .NET SDK. The real native-SDK gate reports unavailable/failing with `dotnet ENOENT`; native compilation/restore/inline-task execution is **not verified here**. The delivered native examples and Linux/Windows SDK CI gate are not represented as successful native runs.

## Native build and inspection

The backend implements Build, Rebuild, Clean, Restore, Pack, Publish, Test (`VSTest` target), custom targets, Evaluate, Preprocess and List targets. It forwards configuration, platform, target framework, runtime identifier, global properties, response files and additional validated MSBuild switches. Graph builds, bounded parallel node selection, verbosity, restore-before-build and opt-in binary logs are exposed. Target-result queries are available in the UI and CLI.

Each job records its exact executable/arguments, output, parsed diagnostics, state, timing, exit code and artifacts. Jobs serialize at the host boundary; parallel project work is delegated to MSBuild. Cancellation and timeout handling terminate the process tree, output is bounded, and a job becomes terminal only after output/query/artifact finalization. Missing executables and failed operations remain explicit failures; there is no silent browser-compiler fallback.

Evaluation displays native properties and items/metadata; preprocessing displays or downloads the expanded project; target queries display native target results. Captured logs/binlogs and supported outputs can be downloaded. Default artifact enumeration may include pre-existing `bin/` outputs; evaluated output paths inside the workspace are also supported. Artifact paths are live files, not immutable build snapshots or proof of provenance.

## IDE integration and project editing

Three independent dock tools bring the workspace to **25 tools**: **MSBuild**, **MSBuild Evaluation**, and **Project Source**. A Native build layout arranges source/project XML, evaluation, explorer and build controls together. They retain the existing docking, floating, tabbing and layout behavior.

Native workspace attachment is explicit and separate from browser preview recovery. Build/evaluation requires a host trust option and the UI request trust control. Native mode does not automatically evaluate projects on edits. Source and project/configuration XML can be edited and saved from the IDE; save-before-operation includes both kinds of buffer. Diagnostics navigate to the emitting project's source file and correct text position, including linked/sibling source cases inside the workspace.

Raw project editing preserves comments, unknown XML, SDK references, imports and custom task syntax instead of flattening the file. Existing UTF-8/BOM and BOM-marked UTF-16 encodings are retained. SHA-256 snapshots detect external changes; writes are checked twice and individually replaced atomically. A multi-file save is **not** an atomic transaction. Partial failures identify completed writes, reconcile their hashes, and retain unsaved or concurrently typed changes. There is no OS file lock or unconditional race-free guarantee.

SLNX inspection reads the current XML as data, showing folders, projects, dependencies, configurations and mapping/property elements without execution. The native engine, not that structural view, determines authoritative solution build behavior. Creation helpers add basic SDK-style projects and solutions referencing existing projects; they do not scaffold all application files or install dependencies.

Build-output **Inspect IL** opens managed DLL/EXE bytes in the existing decompiler without replacing native source. Generic DLL/EXE file inputs preserve the native workspace too. Importing loose source explicitly switches to a browser preview rather than building a stale native project. This update does not make arbitrary native build outputs executable in the bounded browser IL VM, nor add CLR process debugging.

## Portable project loader improvements

The browser-only loader gains local Import/ImportGroup and Choose handling, sorted wildcard imports, bounded duplicate/cycle detection, global property immutability, item definition defaults, final-property item conditions and additional numeric/version comparisons and condition functions. Unsupported native tasks, property functions, packages and binary references still produce diagnostics. Preview project references remain source-combined, not separately linked assemblies.

## Examples

`examples/msbuild/` contains four documented example groups and a coverage manifest:

| Group | Intended native coverage |
| --- | --- |
| `SdkWorkspace/Workspace.slnx` | .NET 10 application/library, separate project references, solution folders and configurations, inherited and imported build files, incremental generated source, evaluation, custom targets, pack and publish |
| `IncrementalPipeline/Build.proj` | Imports, property functions, item metadata/transforms/batching, incremental copy, target dependencies, response file, inline Roslyn task and intentional failure/OnError |
| `LocalPackages` | Pack to a local feed, NuGet configuration, central package versions, restore and a consuming application |
| `MultiTarget/MultiTarget.csproj` | .NET 8/.NET 10 multi-target build requiring both reference packs |

These are real project inputs, not substituted preview files. Their structure and adapter contracts are tested locally; native compilation requires the separate real-SDK gate. Existing Studio source examples, managed fixtures and previous regression suites remain included.

## Start the native IDE

Install Node 22+ and the SDKs/workloads needed by the project. From the extracted source directory:

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm run msbuild -- serve --root "/absolute/path/to/your/workspace" --studio dist --trust-projects
```

Open the exact token-bearing loopback URL printed in the terminal. In Studio select **Use native workspace**, select the project/solution, review it and enable the trust control before an operation. Native projects execute with local OS permissions; only enable this for code and dependencies you intend to trust.

To open the included native examples, use `--root examples/msbuild`. The prebuilt `dist/` directory is included. The standalone HTML still runs the browser IDE, but native MSBuild requires the same-origin local host; it cannot invoke OS build tools by itself.

See [the complete native integration guide](msbuild.md) for direct CLI commands, selecting Windows MSBuild, reusable APIs, operation limits, security and troubleshooting.

## Validation and boundaries

**1,152 Node tests** pass (146 above the 1,006-test uploaded baseline); **119 JavaScript modules** pass syntax checks; **140 browser checks** pass across six suites; **23 standalone checks** pass with two actual workers; **all 16 packages** install and execute offline, including installed LSP/DAP executables and the native CLI help path. See [validation](validation-0.7.0.md) for scopes and reproduction.

Native process lifecycle/HTTP tests use actual Node processes, HTTP sockets and temporary disk files against an explicitly named MSBuild simulator. The new browser suite uses an explicit client test double, production Studio code, actual compiler/runtime workers and real DLL bytes. Neither is counted as native-SDK execution. The screenshot labels the test double rather than presenting it as a real MSBuild result.

The service binds to loopback, checks Host/Origin, uses an ephemeral token, rejects API traversal/symlink paths and launches without a shell. **It is not a sandbox:** native tasks/imports/packages/property functions may execute code with host permissions, use the network or write outside the API root. Do not expose the service publicly or run untrusted workspaces.

Remaining gaps include a browser-native full MSBuild engine, full Visual Studio project/dependency hierarchy and design-time build services, full Roslyn language services/refactorings, NuGet credential/package management UI, Test Explorer, native process/PDB debugging, filesystem watching, binlog visualization and broader compatibility qualification. Full C#/CLR/Visual Studio parity is not claimed.
