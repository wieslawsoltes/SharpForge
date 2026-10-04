# Portable and native evaluation comparison

`compareMSBuildEvaluations(portable, native, options)` compares only the requested
property names, item types and item metadata. Property names are case insensitive;
missing values remain different from empty strings. Item order is significant.
Native workspace prefixes and path separators are normalized for path metadata.
The result contains `equal` and individual `differences`, each with its feature,
property/item name, item position when applicable, and both observed values.

`qualifyMSBuildCorpus({corpus, boundary, evaluatePortable, evaluateNative, signal,
reference})` processes at most 10,000 fixtures sequentially. The two evaluators are
explicit asynchronous callbacks. Each fixture names a declared boundary feature;
an unknown feature rejects the request. Cancellation is checked between cases and
the same signal is passed to each evaluator. Evaluation failures remain failures.

The versioned boundary is committed at
`packages/project-system/src/evaluation/boundary.json`. It separates supported,
approximated and native-only features. A native-only fixture must produce its
declared blocking error; it is never sent to the native callback by this harness.
A supported mismatch is a regression. An approximated mismatch remains a fully
reported difference. Any portable blocking error prevents a successful comparison.
Omitting the native callback always records `native-not-run` and cannot qualify
the corpus, including when every portable boundary check succeeds.
Supplying an unused callback has the same outcome: at least one native comparison
must complete before the report can claim `native-executed`.

The checked-in corpus covers property ordering, conditions, ordered Include /
Update / Remove items, local import ordering and one string property function.
Ten additional fixtures exercise every declared native-only boundary. This small
corpus is a reproducible comparison set; it does not establish complete MSBuild,
SDK, operating-system or package compatibility.

## Running the completed scope

With the desired SDK already installed and its executable explicitly selected:

```sh
SHARPFORGE_DOTNET=/path/to/dotnet SHARPFORGE_SDK=10.0.201 \
  node scripts/limited.js node tests/msbuild-differential/run.mjs --output evaluation-native.json
```

The runner creates its own temporary workspace, pins the requested SDK with
`global.json`, queries real MSBuild properties/items through `NativeMSBuild.runTool`,
and records the exact executable, arguments, SDK/MSBuild versions, Node version and
platform. Each native command has a 60-second limit. The engine is closed and the
owned temporary directory removed even on error. No package restore is required
by these fixtures. The four public contract tests run within the scheduled A23
scope; neither a missing SDK nor a missing native run is reported as success.

The retained Linux SDK 10.0.201 / MSBuild 18.3.0.15422 capture has five matches,
ten enforced portable boundaries and zero divergences. Its provenance and source
hashes are recorded in `planning/evidence/project18/evaluation-corpus-publication.json`.


## Solution configuration oracle

`tests/msbuild-differential/solutions.mjs` compares the mapping model with real
MSBuild builds of `.slnx` and serialized `.sln` files. The fixtures cover default
CLR mappings, mixed managed/native solution entries, wildcard configuration and
platform overrides, build participation, stable project GUIDs, mapped project
requests and portable effective configuration values.

```sh
SHARPFORGE_DOTNET=/path/to/dotnet SHARPFORGE_SDK=10.0.201 \
  node scripts/limited.js node tests/msbuild-differential/solutions.mjs --output solutions-native.json
```

Each fixture uses a package-free custom `Build` target that writes its observed
`Configuration|Platform`. Native commands have a 30-second limit, use one MSBuild
node and disable node reuse. The runner closes its engine and deletes only its
owned temporary workspace. A `.vcxproj` filename checks solution participation;
it does not invoke or qualify a C++ compiler. The retained Linux capture passes
16 solution builds, three mapped project builds and three portable context checks.

## Installed test-framework oracle

`tests/msbuild-differential/frameworks.mjs` consumes the same checked-in xUnit,
NUnit and MSTest fixtures as the portable runner tests. It discovers names and
runs each fixture through Source VM and direct CIL, then uses `NativeTestAdapter`
to compare actual native discovery and TRX outcomes. Native execution requests
coverage and each discovery/run command has a 120-second limit. The SDK and the
fixture's pinned packages must be available; a restore or adapter error remains
an unsuccessful, explicitly unqualified report.

```sh
SHARPFORGE_DOTNET=/path/to/dotnet SHARPFORGE_SDK=10.0.401 \
  node scripts/limited.js node tests/msbuild-differential/frameworks.mjs --output frameworks-native.json
```

The fixtures intentionally include one failing test and one skipped test per
framework. Their comparison report succeeds only when actual native names and
outcomes match both portable engines without native diagnostics. Expected
fixture failures must not be relabelled as successful test outcomes.

If an already established native prerequisite is unavailable, explicitly set
`SHARPFORGE_NATIVE_TESTS_UNAVAILABLE` to its observed reason. The runner then
records portable outcomes, `nativeExecuted: false`, `success: false` and exit code
1. This option never substitutes portable results for native reference results.

The retained portable capture has xUnit six passed / one failed / one skipped,
and NUnit and MSTest four passed / one failed / one skipped, on both engines.
The only shared native package restore reached its 50-second bound with an empty
cache and no diagnostic beyond `Determining projects to restore...`. Its cause
was not established. Native framework, coverage and cross-platform parity remain
unqualified. Exact source/capture hashes, reference versions and case identities
are in `planning/evidence/project18/msbuild-oracles-publication.json`.
