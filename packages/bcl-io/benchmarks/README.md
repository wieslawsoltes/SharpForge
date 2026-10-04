# StringWriter scalar benchmark

`string-writer-scalars.mjs` prepares a bounded comparison with integrated draft #4517,
commit `726fbd8303042c7634a057807b51adeaddffa9a8`. Both comparison checkouts
include main `00c2489e659cbeaa29e9c5dfa4a3137fae4bd4ad`, sharing the merged
Stopwatch and allocation-observer prerequisites. The original draft head was
`bac87e4fcb3264886d6eeb6fff4c8089c29865c4`; its older captures retain that identity. It follows the measurement
conventions of `scripts/benchmarks/a09-string-writer-line-buffer.mjs`. Preparation
does not establish performance results: run both revisions during the integration
owner's single scheduled validation lane before reporting measurements.

## Workloads and bounds

Both real JavaScript platform adapters are exercised: source bytecode and CIL.
These are direct platform-dispatch measurements, not compiler or end-to-end
interpreter throughput measurements. The runner checks exact resulting UTF-16
text after every sample and verifies that invocation roots were released.

The 51 workloads per engine comprise eleven unchanged string, character, whole
buffer, sliced buffer, and separate-value/newline controls; sixteen unchanged
preformatted string controls; sixteen typed scalar operations; and eight typed
scalar writes followed by a separate parameterless newline call. The latter 24
paths are explicitly skipped on #4517, which has none of the scalar contracts.
Their current-revision timings are qualification data, with no invented baseline.

All selected released controls run on every selected engine before any new scalar
workload runs. The workload loop remains outside the engine loop, so new source
scalar work cannot precede CIL controls. Within each group, cases retain their
original workload order. This removes the earlier runner's unequal execution
history caused by interleaving candidate-only work with later controls. Existing
captures from that runner remain historical evidence; they are not corrected by
changing the runner and cannot be compared directly with its new output.

Every workload has one excluded warmup and five retained samples. Setup, argument
preparation, explicit host GC and final `ToString` materialization are excluded.
Managed builder growth remains inside the timed region. The JSON includes raw
samples, elapsed milliseconds, managed allocation counts and bytes, and array
slot-write counts. It does not measure all host JavaScript allocations.

The default is 64 calls and 1024 input buffer units. Calls must be 1–1024, input
length 1–4096, and each writer is capped at 262144 output units. Scalar inputs
include unsigned bounds, an Int64 beyond the Number exact-integer range, Single
0.1, a difficult Double default-format value, and a scaled Decimal. Timing
includes the normal write observer used to count array stores in both revisions.

Median and nearest-rank p95 are reported. With five samples, p95 is the largest
retained sample; it is a small-sample comparison, not a reliable tail-latency
estimate. Compare unchanged controls individually. Separate-value/newline paths
make two dispatches per loop, which the output records explicitly.

## Serial commands

Use a quiet machine, the same Node version and GC mode, and clean tracked source
in both worktrees. Workspace package links must already resolve within their own
checkout, including `@sharpforge/bcl-io`; installation and lockfile reconciliation
belong to the integration owner. Do not copy `node_modules` from another revision
or run this workload alongside tests, builds, captures, or other benchmarks.

From the scalar implementation checkout, prepare a separate detached baseline
and copy the exact runner to its same repository-relative location:

```sh
git worktree add --detach ../SharpForge-p9-writer-scalars-benchmark-base 726fbd8303042c7634a057807b51adeaddffa9a8
mkdir -p ../SharpForge-p9-writer-scalars-benchmark-base/packages/bcl-io/benchmarks
cp packages/bcl-io/benchmarks/string-writer-scalars.mjs ../SharpForge-p9-writer-scalars-benchmark-base/packages/bcl-io/benchmarks/
mkdir -p ../project9-writer-scalar-benchmarks
```

After the owner has prepared each checkout's workspace links, run the baseline:

```sh
cd ../SharpForge-p9-writer-scalars-benchmark-base
node scripts/limited.js node --expose-gc packages/bcl-io/benchmarks/string-writer-scalars.mjs 64 1024 > ../project9-writer-scalar-benchmarks/baseline.json
```

Then run the scalar checkout, passing that captured baseline for comparison:

```sh
cd ../SharpForge-p9-writer-scalars
node scripts/limited.js node --expose-gc packages/bcl-io/benchmarks/string-writer-scalars.mjs \
  64 1024 ../project9-writer-scalar-benchmarks/baseline.json \
  > ../project9-writer-scalar-benchmarks/current.json
```

The comparison checks the baseline commit, exact runner SHA-256, Node version,
operating system, architecture, CPU model, calls, input length, warmups, samples,
explicit GC mode, selected engines, selected cases and control ordering before
taking measurements. For each unchanged workload it
reports median/p95 percent differences and managed allocation/byte/store deltas.
The JSON records the actual current commit. Retain both reports with the
integration evidence and identify their exact tested revisions in the PR.

## Targeted comparisons

The three positional arguments keep their existing meaning and defaults. Add
`--engine source` or `--engine cil` to select one adapter; omitting it selects both.
Use repeatable `--case NAME` options for exact workload names from the array in
the runner. Omitting them selects every workload. Case order follows the original
array within the control/scalar groups, independently of option order. Unknown
options, engines or names, duplicate selectors and missing option values fail
before sampling. There are no substring or wildcard selectors.

For example, from the prepared baseline checkout:

```sh
node scripts/limited.js node --expose-gc packages/bcl-io/benchmarks/string-writer-scalars.mjs \
  256 256 --engine source --case whole-buffer-line-control \
  > ../project9-writer-scalar-benchmarks/source-buffer-line-A1.json
```

From the candidate checkout, use exactly the same selectors and pass that baseline:

```sh
node scripts/limited.js node --expose-gc packages/bcl-io/benchmarks/string-writer-scalars.mjs \
  256 256 ../project9-writer-scalar-benchmarks/source-buffer-line-A1.json \
  --engine source --case whole-buffer-line-control \
  > ../project9-writer-scalar-benchmarks/source-buffer-line-B1.json
```

For a scheduled ABBA comparison, retain baseline A1, candidate B1, candidate B2 and
baseline A2 as separate outputs in that order. Keep the same runner, selectors and
configuration for every process. Analyze all four retained results; do not replace
an earlier sample or treat a changed sign as proof of noise. New scalar workloads
can be selected in a separate candidate run, retaining their absent-baseline status.
Filtering changes only the selected workloads and engines, not their input values,
sampling policy, host GC, timers, correctness checks or allocation/store counters.

A slowdown exceeding the repository's 5% existing-benchmark budget requires a
concrete investigation and the justification/sign-off required by CONTRIBUTING.
Repeat only to resolve a specific remaining measurement risk, preserving the
original samples. No performance result is claimed by the runner or this document.
