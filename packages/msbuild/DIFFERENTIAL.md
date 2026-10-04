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
