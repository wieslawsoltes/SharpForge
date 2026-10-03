# Native MSBuild examples

These are native build inputs for **SharpForge 0.7's local MSBuild backend**, not examples that the browser compiler can fully execute. Install .NET 10 first; MultiTarget also needs .NET 8 reference packs. `npm run test:msbuild:native` executes these with the real installed SDK and fails when it is unavailable. No native SDK run was possible in the release container; XML structure and fixture contracts have separate regression tests.

Start the native IDE from the source root:

```sh
npm run msbuild -- serve --root examples/msbuild --studio dist --trust-projects
```

Open the printed URL, choose **Use native workspace**, select a solution/project, and enable trust only after reading its code, imports and targets. The host and UI both require explicit native execution consent.

## SdkWorkspace

Select `SdkWorkspace/Workspace.slnx`, choose Release, and Build with restore enabled. This example has separate App and Library projects; solution folders/configurations/build dependencies; inherited `Directory.Build.props` / `.targets`; a local imported version file; a Choose branch; additional-file metadata; checked arithmetic settings; and incremental source generation using a target before CoreCompile. Library uses generics/LINQ through the actual SDK compiler, not SharpForge's source subset.

Expected native application output after a successful build:

```
Native MSBuild: 42 / generated 42
```

Evaluate `SdkWorkspace/App/App.csproj` to view Compile, ProjectReference and AdditionalFiles metadata. Preprocess shows the SDK/import-expanded project, while List targets shows actual available targets. Running the custom `DumpBuildContract` target with a target-result query returns Compile items. Pack the Library or Publish the App. No external NuGet packages are required; the local NuGet.config clears external feeds.

The generated `BuildTag.g.cs` is under `obj/<Configuration>/net10.0`. Its producing target has Inputs/Outputs; a separate target includes it on every compile so an up-to-date generation target does not remove it from compilation. The real SDK gate checks its timestamp remains unchanged across a no-change rebuild.

## IncrementalPipeline

Select `IncrementalPipeline/Build.proj`. The imports define properties and a `RoslynCodeTaskFactory` inline task. Build copies two input files to `bin/pipeline` using metadata and transforms. Repeating the build should retain copied-file timestamps. Clean removes outputs; Rebuild chains Clean and Build. The custom `RunInline` target runs UppercaseText. The intentionally failing `Diagnose` target emits a warning and error and invokes its error handler; it must not be counted as a successful build.

`IncrementalPipeline/release.rsp` demonstrates a response file. In advanced arguments enter `["@IncrementalPipeline/release.rsp"]` when the workspace root is `examples/msbuild`. The native engine interprets response-file switches, not a JavaScript parser.

## LocalPackages

A self-contained local NuGet workflow: pack `LocalPackages/Producer/Producer.csproj` with restore, restore `LocalPackages/Consumer/Consumer.csproj`, then build Consumer. Producer writes a `SharpForge.LocalPackage.1.0.0.nupkg` to `LocalPackages/feed/`; Consumer's NuGet.config points to that directory. `Directory.Packages.props` supplies a central package version. No remote package source is configured.

Expected Consumer output: `42`. Native execution from a terminal after building is separate from the browser IL debugger:

```sh
dotnet examples/msbuild/LocalPackages/Consumer/bin/Debug/net10.0/Consumer.dll
```

The local feed output is not under `bin/`, so it is not in the default discovered output list. It remains on disk. Consumer source/PackageReference and central metadata remain editable in Project / Solution Source.

## MultiTarget

Select `MultiTarget/MultiTarget.csproj`, leave the Framework input blank, and Build with restore. `TargetFrameworks` contains `net8.0;net10.0`. Both target reference packs must be available. Setting Framework to one value selects that inner build. Missing SDK/reference packs are native engine failures, not silently substituted targets.

## CLI alternatives

```sh
npm run msbuild -- build SdkWorkspace/Workspace.slnx --root examples/msbuild --trust-projects --restore --configuration Release --binlog --max-nodes 2
npm run msbuild -- evaluate SdkWorkspace/App/App.csproj --root examples/msbuild --trust-projects --configuration Release --json
npm run msbuild -- target IncrementalPipeline/Build.proj --root examples/msbuild --trust-projects --target RunInline
npm run msbuild -- target SdkWorkspace/App/App.csproj --root examples/msbuild --trust-projects --target DumpBuildContract --result-target DumpBuildContract
```

Build outputs are ordinary native DLLs. Inspect them through **Inspect IL**, but do not assume the full Roslyn/BCL output can run in SharpForge's bounded browser VM. No native CLR process debugger is included.
