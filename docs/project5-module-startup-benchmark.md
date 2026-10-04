# Module-startup benchmark preparation

This runner is prepared for the SF-A02-T72 module-initialization correction. No benchmark results are supplied by
this preparation. Run it only in the assigned serial slot after the module correctness and native capture checks.

The baseline is fixed to `fc4d9d994d93d75bac94131da62faa8fd13442d3`, the retained pre-fix probe commit. The candidate
requires an explicit full SHA and a clean checkout. The initial corrected production source was at
`629a86aae8ab453a0e35785e64513d2e78a7669e`; later qualification/evidence commits may advance the selected candidate.

## Comparable programs and reference evidence

Only two existing fixtures are used, with their exact source and Roslyn-pin identities checked before measurement:

| Fixture | Expected output | Purpose |
|---|---|---|
| `module-initialization/no-initializers` | `main\n` | Ordinary startup with no module initializer |
| `module-initialization/plain-main` | `module\nmain\n` | Plain static Main and one module initializer |

Both controls passed their output assertions in the retained pre-fix
`tests/fixtures/module-initialization/qualification/baseline.log`. The old compiler inlined initializer calls into
Main, which happens to produce the correct order for this plain-Main control. It does not make the old library,
static-field, static-constructor or pre-entry-fault behavior correct. Those cases belong to correctness qualification
and are not performance baselines here.

The independent reference is `packages/compiler/test/differential/pinned/module-initialization.json`. The runner
checks the selected source SHA-256, pin hash, successful diagnostics and exact output, records the pin-file hash and
Roslyn metadata, and executes each revision's artifact against that output before either timed phase. No reference
compiler is launched by the benchmark.

## Measurement scope

Run compilation and execution in separate processes. Compilation measures only `compileToAssembly` for the selected
program. Execution measures a fresh `CilVirtualMachine(assemblyBytes)` constructor followed by `run()`, including
decoding, verification and actual managed startup. The candidate deliberately changes the compiler, CIL verifier and
runtime; the report records the exact package/source/manifest Git objects for every transitive workspace dependency
instead of rejecting these changes or attributing the result to one helper.

Each workload/revision receives **80 warmup invocations and 20 measured invocations** by default. An ABBA block is
baseline, candidate, candidate, baseline, giving two invocations per revision. There are forty warmup blocks and ten
measured blocks. Workload order rotates between blocks. The report includes raw per-invocation samples, arithmetic
medians, nearest-rank p95, and ratios of the two-revision arithmetic means within each block.

Explicit host GC, memory snapshots, output assertions, PE hashing and VM cleanup are outside the timers. Actual
program Console.WriteLine work and automatic host GC remain inside the measured APIs. Repeated compilation must
produce the same PE bytes as its successfully executed preflight artifact. PE size and SHA-256 are reported for each
revision. Managed instruction/allocation counters are included for the entire constructor-plus-run scope.

RSS, V8 heap and external-memory snapshots describe only the interval around one timed API call. Their deltas are
process-level proxies; both revisions remain loaded in the same process. They are not peak-memory measurements,
leak tests or isolated per-revision resident sizes. The report retains the raw before/after values and summarizes
the deltas without relabeling them as allocation counts.

The loop counts are bounded and even. Each phase has a three-minute default total budget, a ten-second per-call
overrun check and a 100,000-instruction VM limit. Both measured APIs are synchronous, so their elapsed-time checks
occur after a call returns. The total budget is checked between operations, including outside-timer work. Incomplete
and failed rows remain in the report, have no complete comparison, and cause a nonzero exit status.

## Commands for the scheduled slot

Both checkouts must have their own local workspace aliases; the loader verifies them transitively. The benchmark
files may live in the newly committed candidate branch while the two inputs are separate clean snapshot worktrees.
Replace the placeholders with the agreed paths and exact qualified candidate SHA.

Immediately before reporting, the same loader verification checks both inputs again: exact HEAD, clean tracked
files, and every transitive workspace alias, including the physical links rather than only cached Node resolution.
The resolved alias maps must match their initial values. Any failure invalidates every comparison, retains all raw
samples and summaries with their prior measurement status, records both final checks, and produces a nonzero exit.

```sh
node scripts/limited.js node --expose-gc packages/compiler/bench/module-startup-comparison.bench.js \
  --baseline BASELINE_PATH --candidate CANDIDATE_PATH --candidate-sha CANDIDATE_FULL_SHA \
  --phase compile --warmup 80 --samples 20

node scripts/limited.js node --expose-gc packages/compiler/bench/module-startup-comparison.bench.js \
  --baseline BASELINE_PATH --candidate CANDIDATE_PATH --candidate-sha CANDIDATE_FULL_SHA \
  --phase execute --warmup 80 --samples 20
```

The default compilation references are the registry. `--references pack` loads the same installed .NET reference pack
for both compilers before timing and records its version. No native CLR execution timing is implied by that option.
The loader's one trusted dynamic-import call site requires its exact path/count/SHA-256 manifest entry before the
runner is executed. This proposal changes neither the static checker nor any broad exclusion.

Report both controls and both phases, the actual commands/environment, all raw samples and any host contention.
CONTRIBUTING's greater-than-five-percent runtime regression and greater-than-ten-percent output-growth review
thresholds remain visible in the report. A measured correctness cost needs its explicit explanation; passing output
assertions alone is not performance evidence.
