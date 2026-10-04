# Installed SDK selection

The Node entry exports `discoverSdkEnvironment`, `parseSdkList`, `parseRuntimeList`, `parseDotnetInfo`, `findGlobalJson` and `resolveSdk`. Discovery runs the configured dotnet executable with bounded `--list-sdks`, `--list-runtimes` and `--info` calls; it does not load a workspace project. It returns explicit availability, installed paths and preview markers, host architecture/RID, and diagnostic installation guidance.

`findGlobalJson(startDirectory)` searches ancestors in normal SDK-selection order. Configuration text is limited to 1,048,576 UTF-16 units and the search to 128 ancestors. The shared configuration parser permits JSON comments, retains Unicode diagnostic locations and rejects trailing commas for this file. This is a read-only SDK configuration search; project file access retains the workspace's independent root restrictions.

`resolveSdk(globalJson, installed, options)` implements disable, patch, feature, minor, major and all four latest policies. It keeps feature-band and prerelease choices, reports a missing compatible SDK explicitly and carries custom `msbuild-sdks` mappings. When no version is pinned, it selects the highest eligible installed SDK. The result explains its decision. It never installs a toolchain or changes global.json.

## Host registration

`NativeServiceRegistry` is the explicit extension point shared by native adapters. `registerNativeSdkServices(registry, { engine, workspace })` adds `sdk/inventory`, `sdk/resolve` and `sdk/workloads`. Inventory is cached until an explicit refresh. Workload inspection uses the engine's trusted process queue and returns actionable target availability without installation. Duplicate service registration fails; invoking an absent service returns 404; disposables close with the host.

The SDK registration function is independent of context, testing and package adapters. The subsequent authenticated HTTP transport composes it with those independently reviewed service families.

## CLI policy

The CLI exposes the already implemented host policy through `--trust-store`, `--elevated-native`, `--node-reuse`, `--compiler-server` and `--sarif`. Each forwarded switch remains a separate argument token. `MSBUILD_HELP` is a public re-export from a help-data module so the legacy CLI shrinks while retaining its existing interface and messages.

## Qualification

Twelve policy combinations were compared with actual installed `dotnet --version` results on the completed Linux/x64 Node22.23.3 and Node26.10.0 native scope. The retained oracle includes ancestor search, Unicode comments, explicit incompatibility and strict trailing-comma rejection. Thirteen pure discovery/selection vectors accompany that oracle. The installed-sdk test requires `SHARPFORGE_DOTNET`; an unconfigured machine records a skip.

Windows/macOS/arm64, SDK8 CLI startup on this particular host, and installed platform workloads remain explicitly unqualified. The existing native evidence is reused; this projection does not trigger another broad native matrix.
