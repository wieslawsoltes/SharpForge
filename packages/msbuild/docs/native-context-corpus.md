# Native context and process acceptance corpus

These tests bind together the published native process, SDK, context, compiler, build, metadata, binlog and publish contracts.
Run the corpus once after the intended scope is implemented, through scripts/limited.js, with SHARPFORGE_DOTNET and an exact
SHARPFORGE_NATIVE_SDK. The existing qualification runner and its report schema retain actual toolchain and platform identity.

The corpus covers native/portable source and compiler-option parity, generated read-only documents, independent TFM/RID identities,
shared-import cache invalidation, queued build ordering, ten independently recorded Csc argument vectors, graph-affected builds,
fast up-to-date explanations, binlog replay and saved publish profiles. ExplorerWorkshop builds distinct App/Library assemblies,
checks that its shared Counter is public, requires 42 followed by 42, then verifies native CS0122 if Counter is reverted to internal.
The intended example boundary therefore remains valid for a real compiler as well as the separately qualified portable runtime.

The Node entry additionally exposes the existing `shutdownBuildServers({executable, cwd, spawnProcess})` utility. It invokes the selected
SDK's build-server shutdown command with bounded execution, resolves on exit zero and reports `SFMSB_SERVER_SHUTDOWN` on failure.
The optional process factory is the existing host/testing injection seam. NativeMSBuild.close already uses this same utility.

Actual Linux/x64 SDK 10.0.201 runs on Node 22.23.3 and Node 26.10.0 passed these context, compiler-input, graph, example and shutdown
command contracts. The real reusable-worker fixture failed before measurements because this host denied .NET's named-pipe socket.
Its failing Node 22 log is preserved; the known blocked case was excluded on Node 26 and is not reported passing. No speedup or live
reusable-worker cleanup result is claimed. The fixture remains an executable gate for a capable host, without a weakened assertion.

Historical complete native runs reported 297/298 passes on Node 22 (the single host restriction above), and 296 substantive passes
on the filtered Node 26 rerun; the large-log case had already passed separately before an intentional interruption. These overlapping
runs are not additive. Exact commands, results and exclusions remain in planning/evidence/project18/native.json and its native logs.
The corpus is published unchanged in expectation after its dependencies are concrete; it does not trigger a repeated local SDK matrix.
