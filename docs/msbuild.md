# Native MSBuild and solution integration — SharpForge 0.7

## Two explicit engines

SharpForge now has a local native build backend as well as its existing portable JavaScript compiler. **The native backend invokes installed MSBuild; it is not a JavaScript imitation of MSBuild and does not translate a native solution into a source-combined preview.** Native projects produce their normal separate outputs through their installed SDK, tools, targets and compilers. No .NET runtime is embedded in the browser or shipped in the package.

`dotnet msbuild` provides the MSBuild command-line capabilities for SDK-style projects. Projects needing the full Windows MSBuild toolset, .NET Framework tasks, Visual Studio components or platform-specific workloads need the appropriate installed engine and dependencies. Select that executable when starting the host. A `.csproj` extension alone does not make every project cross-platform.

Native `.csproj`, `.slnx`, `.sln` and other MSBuild project inputs are passed directly to the native engine. MSBuild owns evaluation and execution of imports, SDK resolution, property functions, conditions, item metadata/transforms, batching, target ordering, incremental Inputs/Outputs, custom tasks, Roslyn generators/analyzers, project references, restore and package behavior. SharpForge supplies the editor, transport, lifecycle, inspection and output tools. Feature availability follows the installed engine and project dependencies—not an expanded allowlist in the browser compiler.

The portable **Open folder** / file-input path is still bounded and source-combined. It now understands more local imports/conditions but does not execute targets, install packages or load native analyzer DLLs. Never use its success as evidence that a native build succeeded. Native workspace mode does not silently fall back to that compiler when the SDK is missing.

## Start from the source distribution

Node 22 or later is required for the host. Install the .NET SDKs/workloads needed by your project separately. `.slnx` requires MSBuild 17.12 or later. Evaluated property/item/target-result queries require 17.8 or later. The examples target .NET 10, and the multi-target example also needs the .NET 8 reference packs.

From the extracted SharpForge directory:

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
# dist/ is included; npm run build refreshes it after source changes.
npm run msbuild -- serve --root "/absolute/path/to/your/workspace" --studio dist --trust-projects
```

The command prints a `http://127.0.0.1:4175/#sharpforge-token=...` URL. Open that exact URL. It serves Studio and the API on the same origin. The URL fragment is immediately removed from browser history after reading it; the token stays in memory. Do not share the printed URL. Reloading the clean URL requires reopening the original terminal URL or reconnecting with the session token; credentials are intentionally not persisted.

In Studio, open **Window → MSBuild** or use **Window → Native build layout**. Connection does not run anything or replace the current preview. Choose **Use native workspace** explicitly, select the project or solution, inspect the files, and check the workspace trust control before evaluation or execution. File edits and saves do not trigger builds automatically.

For a Windows engine, start from an environment with the required Visual Studio toolchain, for example:

```powershell
npm run msbuild -- serve --root "C:\work\Solution" --studio dist --engine msbuild --executable "C:\path\to\MSBuild.exe" --trust-projects
```

The owner chooses the executable at host startup. Browser requests cannot select a different executable. The standalone HTML and an unrelated hosted copy of Studio are not cross-origin clients for this host. Use the copy served by the host; CORS is deliberately not enabled.

## Build workspace

The three new independent docking panels bring the total to 25:

| Panel | Purpose |
| --- | --- |
| **MSBuild** | Workspace connection/trust, project selection, configuration/platform/framework/RID, properties, targets, parallelism, graph build, restore, binlog, operation control, output, diagnostics and artifacts |
| **MSBuild Evaluation** | Authoritative property/item metadata JSON, target results, preprocessed XML, available targets; also clearly marked structural `.slnx` inspection |
| **Project / Solution Source** | Raw `.csproj`, `.slnx`, imported `.props`/`.targets` and supported configuration text; conflict-checked saves and creation |

The native layout puts project source beside C# document tabs, evaluation below, and build controls on the right. Panels also use the existing docking/floating/auto-hide system. Switching panels or saving XML preserves the selected document and dirty buffer contents.

**Build, Rebuild, Clean, Restore, Pack, Publish, Test (VSTest), Run target, Evaluate, List targets and Preprocess** are wired operations. Test requests the `VSTest` target; it is not a new graphical test explorer or a Microsoft.Testing.Platform integration. A project without the selected target reports the engine's failure.

Leaving framework blank lets MSBuild use the project's configured frameworks. Explicit Configuration, Platform, TargetFramework and RuntimeIdentifier are global properties. Additional properties use one `Name=Value` per line. Target-result queries have a separate input (`--result-target` in the CLI); they execute the requested targets, including when used alongside Evaluate. Values are escaped for MSBuild instead of interpolated into a shell command. Advanced arguments use a JSON array of individual switches, such as `["-warnAsError", "-detailedSummary"]`; `@relative/path.rsp` is accepted after checking that the response file exists within the workspace. A response file or custom task is trusted native code/configuration, not a sandboxed format.

The host passes argument arrays with `shell:false`, uses one active native operation at a time, supports 1–64 MSBuild nodes, and defaults to no node reuse. Environment variables and existing package credentials are inherited. There is no credential-entry UI and no interactive terminal; use the external toolchain to establish package authentication first. Advanced arguments can change the meaning of an operation, so inspect **Actual invocation** when using them.

Output is streamed/polled into the tool. Standard MSBuild/compiler diagnostics populate the shared Error List, with project-relative source navigation and loaded-buffer UTF-16 offsets. Unrecognized custom log formats remain visible as raw output. Diagnostics are not a replacement for a structured binary-log reader.

Cancel requests terminate the child process group on POSIX and use `taskkill /T` on Windows, followed by a forced termination attempt. Timeouts, output limits, nonzero exits and missing executables produce explicit terminal states. A job is not reported complete until output processing and artifact discovery have finished. Cancellation cannot undo file writes or external effects already performed by tasks.

## Project editing and solution inspection

Project text is not reconstructed from a simplified object model. Comments, unknown elements, imports and custom tasks survive unchanged unless edited. UTF-8 (with/without BOM) and BOM-marked UTF-16LE/BE are decoded and existing encoding/BOM is preserved on save. Textareas may normalize line endings when users edit their content. Other encodings and binary files are not editable through this API.

Each loaded text buffer has an SHA-256 disk snapshot. Save preflights all selected files, checks again before replacement, and uses a temporary file plus rename for existing files; new files are created exclusively. A later failure reports which earlier files were written. **A multi-file save is not an atomic transaction.** This is conflict detection, not an OS filesystem lock: a malicious concurrent process or a narrow final-check/rename race is outside the guarantee. Symlinks are not followed by workspace APIs.

The normal source **Ctrl+S** command saves native source when attached to a native workspace. XML has its own save command and shortcut. Save-before-operation includes both dirty native C# buffers and open project/configuration buffers. Disabling save-before-operation while dirty changes exist makes the operation fail explicitly instead of silently building stale disk input.

Creation helpers produce a basic SDK-style `.csproj` or a `.slnx` linking existing projects. New files require an existing containing directory. Native projects can then be edited as raw XML; creating a project does not scaffold an entire application or install an SDK.

**Inspect solution structure** reads the current, possibly unsaved `.slnx` as data: folders, files, projects, build dependencies, configurations and mapping/property elements. It does not run MSBuild and does not pretend to evaluate solution mappings. For authoritative mapping/build behavior, build the solution with the installed engine. The file explorer is a filtered workspace file list, not a full Visual Studio project/dependency hierarchy.

Source outside the declared root can still be imported/built by trusted MSBuild, but cannot be read/edited through the workspace API. Choose a common containing root for sibling projects. Native source gets the existing bounded browser editor services; native compilation does not turn them into full Roslyn language services, refactoring or design-time build sessions.

## Evaluation and output inspection

Evaluate queries multiple properties and selected items/metadata using the native command line. Without additional target switches this evaluates but does not run build targets; **evaluation itself can run property functions and resolve SDKs**, so it requires the same trust as Build. The backend requests JSON, validates the response and reports older/unsupported query behavior rather than inventing a result.

Preprocess and List targets use the native engine's corresponding switches. Preprocessed project files and binlogs can reveal local paths, environment values and sensitive data. Binlog capture is opt-in and requests `ProjectImports=None`; this reduces copied import source but does not guarantee a secret-free log. The inspector displays smaller results inline and offers file downloads for the complete captured artifacts. Large inline views and log history are bounded.

Successful operations enumerate existing supported artifacts in project `bin/` directories; this list can include outputs from earlier builds and is not a provenance guarantee. Paths obtained from evaluated `TargetPath` or target-result items can also expose custom output directories **inside the workspace**. Out-of-root outputs remain in the query result but are not downloadable. Files may be removed by a later Clean/build, so an old job's artifact is a live path rather than an immutable copy.

**Inspect IL** loads a listed managed DLL/EXE into the existing decompiler without replacing the native workspace. Its verification, execution and debugging limits remain unchanged. Building an arbitrary C# solution successfully does **not** mean all of its emitted code, runtime dependencies or native calls can execute in SharpForge's bounded browser IL VM. Native process debugging, Portable PDB source debugging and a managed CLR process runner are not added here. F5 can still continue an already paused ordinary-IL debug session while a native workspace is attached.

## API and limits

`@sharpforge/msbuild` exports browser-safe contracts, the authenticated client and structural `.slnx` helpers. `@sharpforge/msbuild/node` exports the native workspace, job engine and loopback server. The packaged `sharpforge-msbuild` executable works without the source monorepo; pass the browser distribution directory with `--studio` when serving the IDE.

```js
import { NativeWorkspace, NativeMSBuild } from '@sharpforge/msbuild/node';

const workspace = await NativeWorkspace.open('/path/to/trusted/workspace');
const engine = new NativeMSBuild(workspace, { trusted: true });
try {
  const started = await engine.start({
    action: 'build', project: 'MySolution.slnx', trusted: true,
    configuration: 'Release', restore: true, binaryLog: true, maxNodes: 4
  });
  const result = await engine.wait(started.id);
  if (result.status !== 'succeeded') throw new Error(result.error ?? 'Build failed');
  console.log(result.diagnostics, result.artifacts);
} finally {
  await engine.close();
}
```

Defaults: 20,000 editable workspace entries, 48 directory levels, 4 MiB per text file, 256 changes/32 MiB per save, 128 MiB per downloaded artifact, 30 minutes per operation, 32 MiB total captured output, 1 MiB recent streaming events, 10,000 parsed diagnostics and 32 retained job records. Jobs are serialized; build parallelism runs inside the selected MSBuild job. Configurable API limits remain bounded. These are adapter limits, not limits on all memory/files/network consumed by trusted native tasks.

Job logs live under `.sharpforge/msbuild/`. Evicting a completed in-memory job does not delete its files. Remove old job directories when the host is stopped; no automatic disk-retention service is implemented. Do not commit logs, binlogs, credentials or `.sharpforge` to version control.

## Trust and deployment boundary

The service binds only `127.0.0.1`, checks the exact Host header and same Origin, rejects cross-site API requests, requires an ephemeral Bearer token, has no permissive CORS, and does not invoke a shell for MSBuild. File APIs reject traversal, reserved paths and symlink components. The served application uses a restrictive same-origin policy.

**None of those controls make a build safe to run on an untrusted project.** A task, package, SDK resolver, property function, import or analyzer can run code with the host's OS permissions, touch files outside the declared workspace or use the network. Start the host and enable trust only for workspaces and their dependencies that you intend to execute. Do not expose it through a reverse proxy, port-forward it, use it as a multi-user service or bind it to a public interface. Authentication is a session capability, not enterprise authorization.

## Verification and upstream references

`npm test` covers the browser evaluator, contracts, real temporary disk operations, authenticated loopback HTTP and actual child-process lifecycle against a **clearly named MSBuild process simulator**. It verifies the adapter, not Microsoft MSBuild's semantics. The new browser acceptance suite uses an explicit client test double, production Studio modules, real compiler/runtime workers and actual managed assembly bytes. It does not execute the native engine.

`npm run test:msbuild:native` is a separate real-SDK gate: it invokes installed MSBuild, compiles and executes outputs, and checks incremental generation, inline tasks, restore/package/publish and multi-target behavior. It never uses the simulator. The .NET-enabled CI matrix runs that gate on Linux and Windows with .NET 8 and 10 SDKs. **This environment has no .NET SDK; its native gate result is unavailable/failing, not passing or silently skipped. Hosted CI has not been run for this distribution.** See the release validation report for actual local results.

Primary specifications and documented behavior consulted:

- [dotnet msbuild and SDK-style scope](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-msbuild)
- [MSBuild command line, SLNX, switches, targets and preprocessing](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-command-line-reference)
- [Property/item/target-result queries](https://learn.microsoft.com/en-us/visualstudio/msbuild/evaluate-items-and-properties)
- [Property functions](https://learn.microsoft.com/en-us/visualstudio/msbuild/property-functions)
- [Official SLNX schema](https://github.com/microsoft/vs-solutionpersistence/blob/main/src/Microsoft.VisualStudio.SolutionPersistence/Serializer/Xml/Slnx.xsd)
- [RoslynCodeTaskFactory](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-roslyncodetaskfactory)

Native backend integration is implemented. A universal MSBuild compatibility certification, complete browser MSBuild engine and complete Visual Studio replacement are not claimed.
