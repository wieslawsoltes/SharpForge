# Native qualification runner

The qualification directory provides an explicit, serial installed-toolchain runner. It executes real restore, build, pack and publish
against a pinned two-project SDK fixture, then verifies both successful artifacts and an intentionally failing MSBuild target. Pack
inspection reads the actual nupkg through the existing archive contract. Solution cases exercise both .slnx and .sln with graph mode
on and off; older MSBuild versions that reject .slnx remain explicit unsupported results.

Run the matrix only after the intended scope is implemented, through the repository resource wrapper:

```sh
SHARPFORGE_DOTNET=/absolute/path/to/dotnet \
SHARPFORGE_QUALIFY_SDKS=8.0.425,10.0.201 \
node scripts/limited.js node packages/msbuild/qualification/run.js /absolute/path/to/report.json
```

Each selected version must appear in the installed SDK inventory. Fixture global.json disables roll-forward, retaining prerelease
selection when explicitly requested. Without an explicit version list the runner selects the latest installed stable and preview SDKs.
The version list accepts at most sixteen versions. Reports retain Node version, architecture, source revision and dirty status, exact
SDK inventory, invocations, diagnostics, artifact checks, measured action durations and each failed, skipped or unsupported cell.
Timings include the positive and negative fixtures; they are not speedup or allocation measurements. Fixture roots remain in the report
for inspection. Engines close in finally blocks; the operator may remove recorded temporary fixture roots after retaining evidence.

`runNativeQualification({executable, outputPath, includeSolutions, sdkVersions})` also returns the same report directly. An invalid
version matrix is rejected before running fixtures. The CLI exits nonzero when any executed SDK cell fails. Unavailable operating
systems, missing SDK selections and absent Windows standalone MSBuild are skipped explicitly and never counted as passing.

On Windows, an installed MSBuild.exe runs the same positive and negative action fixtures, then actual child/grandchild cancellation
and long project/output/diagnostic path probes. The fixture uses Node children and records observed process IDs before cancellation.
A cancelled operation must leave no observed descendant running. Those probes do not simulate Windows success on another host.

## Recorded qualification

The preserved Project18 source contains exact reports for Node 22.23.3 and Node 26.10.0 on Linux/x64. SDK 10.0.201 completed positive
and negative restore/build/pack/publish cells plus both solution formats and graph settings. SDK 8.0.425 failed before MSBuild because
the host CLI Process.GetStat/get_StartTime operation was unavailable; both failures remain recorded. Windows, macOS, arm64, standalone
MSBuild and a preview SDK were unavailable. The separate reusable-worker probe additionally records a host-denied named-pipe socket;
no worker reuse speedup or cleanup qualification is claimed for that restriction.

The two exact matrix reports are planning/evidence/project18/native/qualification-node22-sdk8-sdk10.json and
qualification-node26-sdk8-sdk10.json in original source 7b48e5b51f9bace019dfcfffb83b392b6a455369 and the retained integration evidence.
This publication preserves the already-qualified runner; XML/solution fixture literals are line-wrapped without changing emitted text.
