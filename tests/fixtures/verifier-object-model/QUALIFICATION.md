# Object verifier qualification plan

This is prepared tooling and a fixed protocol, not an execution report. Native
capture, focused tests, browser checks and performance still require the
coordinator's explicit serial validation slot. No result is inferred from the
existence of the fixtures or commands below.

## Source and dependency scope

The object product source is frozen at merge `e543f649`, with all 22 object-batch
files from `69b6c1f7` preserved and qualified literal dependency `88c861e3` merged.
Subsequent preparation changes only benchmark tooling, its focused tests and docs.
The 52 predeclared native cases and explicit ref-like/native differences remain
unchanged. Their source hash is
`2db578c212492c408ef845b1a6bdaf35d34dcf0c0a022c50ef78d9da2c8fd33c`.

The controlled performance baseline is literal-qualified commit
`88c861e3a294a249e7a8cdd7319e032d7c29fb35`, the merge's exact second parent.
Merged-main `c7509a3b` includes additional table-view, metadata, binary, loader and
execution changes absent from this frozen candidate. Comparing those different
sources would confound attribution; the coordinator approved the equivalent
qualified literal parent instead. The detached baseline worktree is
`/workspace/scratch/7e3d2a445c44/sf6-object-baseline-88c861e3`.
Both it and the candidate have 28 workspace package aliases pointing into their
own `packages` directories. No package installation is needed for these commands.

The read-only preparation found SDK 10.0.201, runtime/reference pack 10.0.5 and
167 reference DLLs at the paths below. All five pinned ILVerify files and the
Linux x64 ILAsm executable match the repository hashes. No native process was
run for that inspection. Capture still checks actual SDK/runtime/Roslyn versions,
the complete reference hash, tool identity and the selected-method count.

## Capture and strict replay

Run from the candidate root, in a granted native slot. The fresh directory retains
raw failure evidence; the command does not overwrite a repository fixture:

```sh
object_capture_dir="$(mktemp -d /workspace/scratch/7e3d2a445c44/project6-object-native.XXXXXX)"
env \
  SHARPFORGE_ORACLE_DOTNET=/workspace/scratch/7e3d2a445c44/dotnet-10.0.201/dotnet \
  DOTNET_ROOT=/workspace/scratch/7e3d2a445c44/dotnet-10.0.201 \
  SHARPFORGE_ILASM=/workspace/scratch/7e3d2a445c44/dotnet-tools/ilasm \
  SHARPFORGE_ILVERIFY=/workspace/scratch/7e3d2a445c44/dotnet-tools/.store/dotnet-ilverify/10.0.5/dotnet-ilverify/10.0.5/tools/net10.0/any/ILVerify.dll \
  node scripts/limited.js node tests/fixtures/verifier-object-model/capture.mjs \
  "$object_capture_dir/native.json" > "$object_capture_dir/capture.log" 2>&1
```

`capture.mjs` and the shared helper save input/source/image/tool/reference hashes,
raw stdout/stderr and exit status before parsing and expectation assertions. The
filter `\.Test$` must select exactly one method in each multi-method assembly.
Zero/multiple matches and process failures cannot become accepted rejection cases.
Inspect the complete observation before retaining it as `native.json`; retain any
failed attempt separately. The strict native test intentionally fails when that
file is absent or stale. At preparation time it is absent.

The existing CoreLib category capture is present and feeds the object test helper;
it is not a substitute for the new object-native observations. After retaining
the actual complete capture, the scheduled focused command is:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a03-object-model.test.js tests/a03-object-annotations.test.js \
  tests/a03-object-budgets.test.js tests/a03-object-model-native.test.js \
  tests/a03-verifier-benchmark.test.js \
  tests/a03-inspector-method-view.test.js tests/a03-typed-preparation.test.js \
  tests/a03-numeric-transfers.test.js tests/a03-field-transfers.test.js \
  tests/a03-indirect-transfers.test.js tests/a03-string-transfers.test.js \
  tests/a03-string-budgets.test.js tests/a03-string-metadata.test.js \
  tests/a03-string-native.test.js
```

## Existing-path comparison and added object costs

`benchmark-object-verifier.mjs` reuses the existing numeric, field, literal,
memory and object fixture helpers. It imports the public API and fixtures from
the selected checkout, verifies that checkout owns its CIL package alias, and
uses `scripts/conformance/perf/core.js` for clean source pinning, environment,
schema, correctness checksums and distributions. It does not copy verifier logic
or compare new successful object verification to an older unknown outcome.

The fixed cohort contains nine existing controls: Add_0_0, Diamond, MixedJoin,
ExistingAuthority, LoadOwner, StoreReferenceDerived, StringReturn,
LocalAddressRoundtrip and LoadWideInteger. Baseline/candidate order alternates per
control, starting with baseline Add. Six candidate-only workloads follow:
NewClass, NewArguments, BoxValue, HarmlessAnnotation, UnboxFieldRead and
RepeatedConstructor, which emits 128 constructor/pop pairs. All 24 child runs are
awaited sequentially, each in a fresh Node process with a 180-second bound.
The shared bounded subprocess helper handles cancellation and output limits.

Defaults are one first batch, 20 warmup batches and 100 measured batches, each
with 1,000 verifier invocations. Bounds are 1–5,000 calls/batch, 0–100 warmups and
2–1,000 measured batches. Every result is retained in a bounded array and checked
after timing, including intermediate failures; no assertion or result inspection
runs inside the timer. The operation and result-array writes are timed. Raw heap
deltas include GC and retained result objects and are not allocation counts.

Median uses both middle sorted values for even counts; p95/p99 use nearest rank.
These are **batch-duration** distributions. Dividing a batch by its call count
produces a batch mean, not the latency distribution of individual invocations.
The first batch includes the first invocation and subsequent warm calls; it is
not an individual cold-latency measurement. All chronological first/warm/measured
samples and correctness counts remain in each report's metrics.

Every report records exact product and harness commits, Node executable hash,
driver/protocol/input source hashes and generated fixture identity. CoreLib capture
bytes are hashed when used. The cohort requires paired fixture/capture hashes,
expected outcomes, correctness checksums and Node binaries to match. The package
entry points remain checkout-specific. Both worktrees and the harness must be
clean and unchanged, so retain and commit actual qualification evidence before
starting performance. Put performance output outside both tracked checkouts.

In the explicitly granted benchmark slot, execute once from the candidate root:

```sh
object_performance_dir="$(mktemp -d /workspace/scratch/7e3d2a445c44/project6-object-performance.XXXXXX)"
node scripts/limited.js node packages/cil/tools/benchmark-object-cohort.mjs \
  "$object_performance_dir/cohort" \
  --baseline /workspace/scratch/7e3d2a445c44/sf6-object-baseline-88c861e3 \
  --candidate /workspace/scratch/7e3d2a445c44/sf6-objects \
  --iterations 1000 --samples 100 --warmups 20 \
  > "$object_performance_dir/cohort.log" 2>&1
```

This is one outer resource wrapper; child runs use no nested wrappers. Reports,
process stdout/stderr, failures, commands, chronological order and comparisons
are retained. The coordinator reviews every difference, including >5% regressions.
There is no automatic threshold pass, significance claim, outlier deletion or
retry-until-pass policy. Previous twelve-sample literal/field observations use
different timing instrumentation and are not substituted for this comparison.
Browser and CLR/runtime execution qualification remain separate and unclaimed.
