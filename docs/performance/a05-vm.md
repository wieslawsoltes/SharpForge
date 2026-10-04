# A05 VM performance evidence

The T12 harness measures actual source, reloaded-source and direct-CIL execution, checks every guest result, and retains raw observations. It covers arithmetic, calls, virtual calls, fields, arrays, strings, exceptions, allocation, three startup applications and populated-heap snapshot replay. Measurement and report formats are version 2.

The checked-in `a05-baseline.json` is deliberately **unqualified** until two complete, stable runs have been recorded. An empty baseline, synthetic unit-test data, skipped tests or an unsupported platform can never pass the production gate. This document defines the runnable protocol; it does not claim a measured speedup or completed platform qualification.

Explicit optimization targets, full numeric comparison counts, root/frame measurements, array fairness and the recorded profiler reference are documented in [a05-qualification.md](a05-qualification.md).

## Preparation API

`prepareExecution(vm)` and `executionPreparationCapabilities` are public exports of `@sharpforge/runtime`.

```js
import {VirtualMachine, prepareExecution} from '@sharpforge/runtime';

const vm = new VirtualMachine(image, {sourceFusion: true});
try {
  const preparation = prepareExecution(vm);
  // {status: 'prepared', engine: 'source', methods, fusedInstructions, statistics}
  const result = vm.run();
} finally {
  vm.stop();
}
```

The source path calls the real source-fusion planner. It scans verified methods and counts covered instructions, including a valid zero count when no instruction groups qualify. `sourceFusion:false` returns `status:'disabled'`, zero methods and a reason; it does not pretend to have prepared work. The CIL path caches decode plans for verified reachable methods and returns `{status:'prepared', engine:'cil', methods, numericHandlerCounts, statistics}`. Its frozen `numericHandlerCounts` maps selected handler identifiers to their instruction-site counts; this proves selection, not the number of fast-path executions. Repeating preparation in the same code epoch reuses those plans. Invalidation rebuilds them in the next epoch.

Preparation never advances the guest instruction counter or program counter, emits output, creates guest tasks, allocates managed objects, or compiles the optional Wasm tier. Foreign instances, stopped/faulted VMs and missing verified image/report state are rejected. Host plan allocations and planning time remain part of preparation. Ready, running, paused and waiting VM states can be prepared.

The capability object reports phase availability independently of a particular VM's disabled option. A future runtime without an independent preparation phase must label it `not-required` with a reason; the harness omits its `predecodeMs` metric and records an unavailable phase. It never substitutes a zero-duration measurement.

## Serial validation and measurement

The queue owner runs the focused tests on the final integrated revision, using the repository's limited runner and one test worker:

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 node scripts/limited.js node --test --test-concurrency=1 tests/a05-12-gate.test.js tests/a05-12-harness.test.js tests/a05-12-startup.test.js tests/a05-12-snapshot.test.js tests/a05-12-provenance.test.js tests/a05-12-virtual-routes.test.js
```

Correctness runs include all three startup applications on all three engines, local and available portable snapshot replay after a heap write, invalid evidence, cancellation, disposal and an actually delayed interpreter arithmetic handler. Statistical unit tests use explicitly synthetic reports; production qualification refuses those reports. The measured-handler test uses the same `compareMetric` decision function as the report gate. No synthetic report is native or benchmark qualification evidence.

Commit corrections before measurement. Use the same otherwise idle runner, Node executable, flags, CPU/power mode and operating-system configuration. Do not overlap browser/native checks, builds, tests or other benchmarks. The harness creates at most one cold child and awaits its exit; warm observations run serially in the parent.

Run these commands sequentially:

```sh
export SHARPFORGE_TEST_CONCURRENCY=1
export SHARPFORGE_MAX_PARALLEL_RUNS=1
export SHARPFORGE_MAX_OLD_SPACE_MB=512
node scripts/limited.js node --max-old-space-size=512 --expose-gc bench/vm/harness.js --runner dedicated-node24-01 --samples 100 --warmup 10 --out artifacts/a05-vm-first.json
node scripts/limited.js node --max-old-space-size=512 --expose-gc bench/vm/harness.js --runner dedicated-node24-01 --samples 100 --warmup 10 --out artifacts/a05-vm-repeat.json
node scripts/limited.js node scripts/perf-gate.js --qualify artifacts/a05-vm-first.json --repeat artifacts/a05-vm-repeat.json --out artifacts/a05-vm-baseline.json
node scripts/limited.js node --max-old-space-size=512 --expose-gc bench/vm/harness.js --runner dedicated-node24-01 --samples 100 --warmup 10 --out artifacts/a05-vm-candidate.json
node scripts/limited.js node scripts/perf-gate.js --baseline artifacts/a05-vm-baseline.json --candidate artifacts/a05-vm-candidate.json --out artifacts/a05-vm-gate.json
```

Keep provisional reports under ignored `artifacts/` while measuring. After review, copy the qualified baseline to `docs/performance/a05-baseline.json` and commit it. Writing a tracked baseline between measurement commands would dirty the tree and correctly fail provenance validation. A candidate optimization must be committed before its run; comparing the same revision is only a gate sanity check, not evidence that a code change improved performance.

The initial qualified baseline may describe the final A05 implementation itself. T12 requires a repeatable baseline, startup phases and regression detection; it does not require the audited pre-A05 product revision to serve as that baseline. The first and repeat reports therefore establish current behavior. Keep measured before/after optimization claims in their independent qualification reports. A later documentation commit that installs the baseline does not change the measured commit recorded inside it.

Qualification requires every corresponding median to differ by no more than 5% across two distinct serial runs of the same commit. Both complete reports are retained: the qualified baseline embeds the first run. Median absolute deviation, interquartile range, p95 and p99 are retained alongside each median, so stable medians do not conceal broad sample noise. Failed qualification reports retain the failing stability comparisons. Do not discard inconvenient observations or select the faster repeat.

Reports record the exact child command, beginning and ending commit, clean-tree status at both boundaries, timestamps, Node/V8 versions, executable, operating system, CPU models/count, host identity hash, memory capacity, GC mode, locale, compiled-assembly hashes, fixture hash, an aggregate hash of the harness JavaScript files and VM options. Inherited `NODE_OPTIONS`, the effective V8 `heap_size_limit` in bytes, and all three `SHARPFORGE_*` resource controls are part of the runner fingerprint. `process.execArgv` alone does not show inherited Node flags. Keep the wrapper command and environment alongside the reports as well. A changed revision during the run fails the report. Output writes replace the destination atomically. Gate comparisons never overwrite either input file.

The complete default catalog has 36 measured rows: eight microbenchmarks on three routes, three startup applications on three routes, and snapshot replay on three routes. At 100 samples, each run launches 900 fresh startup children serially; every startup row retains load, verification, preparation and first-output timing. A micro-only or single-engine qualification is useful for its declared subset but does not complete the full T12 baseline. Keep failed and cancelled attempts with their logs; do not remove outliers, splice runs together or select individual faster rows. If a full pair fails the 5% rule, investigate the environment or protocol and run a fresh complete pair without altering the rule.

`--suite micro|startup|snapshot`, `--engine source|reloaded|cil` and `--native-bits 32|64` create independent qualification sets. Defaults are all cases/engines and ABI32. Samples accept 20–10000; warmups accept 1–1000. The default 100 observations provides more tail information than the minimum, but it is not a guarantee of narrow p99 uncertainty. The stable `--runner` identifier is required. A different runner fingerprint, harness, fixture catalog, engine set, phase availability, ABI or protocol requires a new baseline.

## Measurement boundaries

| Case or phase | What is timed and checked |
|---|---|
| Seven ordinary microbenchmarks | One prepared VM per case; the initial snapshot is restored and plans are prepared outside each execution timer. First execution, warmups and measured observations are retained separately. |
| Virtual calls | Direct CIL retains its original class `callvirt` to a derived override, built through public metadata/IL APIs. Source and reloaded-source use a real interface `CALLVIRT` to a class implementation whose result differs from the interface default. Each route executes 20000 calls returning seven and checks a total of 140000. Reports label the distinct dispatch mechanisms and hash the assembly used by that route; these are separate regression series, not a cross-route speedup comparison. |
| Invoice, grid, text-report startup | A fresh Node process for every observation, with no cache carried between observations. Parent compilation is separately recorded. |
| Load | CIL inspector parsing, canonical source reload, or an independent compiler-image clone. |
| Verify | Explicit `verifyCilAssembly` or `verifyImage`; constructor verification is additionally included in construction time. No verification cost is subtracted. |
| Predecode / preparation | Actual verified CIL decode planning or actual source-fusion planning. The phase remains labeled with its execution engine. |
| First output | Execution-to-first-output, load-start-to-first-output, process-uptime-to-first-output, and complete child wall time. Input read/deserialization is reported separately. |
| Snapshot capture and restore | A live initialized array is captured and restored in the same VM. Replay includes a guest array write, then checks the complete expected output for every observation. |
| Snapshot transfer | When portable APIs exist: export, `structuredClone`, fresh-VM construction and fresh-VM import/restore are timed independently. Portable replay output is independently asserted. Missing APIs produce explicit unavailable metrics. |
| Snapshot replay | Guest execution after capture is timed separately from restore/copy. Replay allocation deltas are recorded only between two observations of that same execution interval. |

Source restore intentionally pauses for debugger inspection. `restoreForReplay` explicitly resumes this known replay boundary; normal debugger pauses still fail an unexpectedly paused benchmark. No pause is silently skipped in ordinary execution.

Instructions/sec uses the actual guest instruction counter and measured execution time. The gate recomputes that relationship and rejects mismatched throughput. Cooperative slices use an instruction budget of 10000 and an 8 ms requested time budget, yielding with `setImmediate` between nonterminal slices. These requested budgets are not a claim that every native intrinsic meets a hard 8 ms latency limit.

Managed allocations and allocated bytes are exact VM counter deltas for timed micro execution; startup records constructor-plus-execution totals. They exclude V8 objects and other host graphs. RSS, heap-used/total, external and ArrayBuffer values are separately labeled host-memory gauges, never allocation totals. Exposed host GC runs before warm/snapshot observations outside their timers; managed GC remains inside guest execution. Snapshot restore rewinds managed counters, so no allocation delta is computed across a restore.

Capture diagnostics are reported only if the runtime exposes them. Their absence does not imply COW support. Portable phase availability is detected from the real `serializeSnapshot` and `restoreSerializedSnapshot` exports, retained in the protocol and rechecked at measurement time.

## Statistical decision

The report gate validates the complete expected case set, metric contracts, unavailable-phase declarations, strict first/warmup/measured ordering, unique sample indices, raw counts, correctness, compiled-artifact provenance and recomputed summaries. It rejects non-finite/negative samples, zero latency or throughput, fractional allocation counters and incompatible or unqualified evidence. Baseline qualification is reconstructed from its retained raw repeat before comparison.

For each metric and each declared statistic (latency median/p95/p99, allocation median and throughput median), a degradation must exceed the 5% budget before resampling is needed. The baseline and candidate samples are independently resampled with replacement. A seeded percentile bootstrap then estimates excess over the budget:

- Higher-is-worse metrics: `candidate / (1 + budget) - baseline`.
- Lower-is-worse throughput: `baseline * (1 - budget) - candidate`.

A regression is confirmed only when both the observed excess and the lower endpoint of its 95% two-sided confidence interval exceed zero. Intervals are expressed in metric units over the budget; the observed relative change is reported separately. This tests the requested relative budget while avoiding division by zero when allocation bootstrap samples contain zeros. At an originally zero allocation median, any statistically confirmed positive increase is an absolute regression. Zero throughput is invalid.

The algorithm is an independent percentile bootstrap, not a paired bootstrap or a BCa interval. Default seed is 12012 and default resamples is 10000; both are retained in gate output. Confidence is per metric and no family-wise error guarantee is claimed. A point estimate beyond the budget whose interval still overlaps zero is explicitly `inconclusive`; it contributes to the report's inconclusive count. `passed` means no statistically confirmed regression under this protocol, not proof of equivalence or an achieved performance target.

Exit codes are 0 for qualification/comparison without a confirmed regression, 1 for a confirmed regression, and 2 for malformed, incompatible, unqualified or synthetic evidence.

## Coverage boundaries

| Target or capability | Qualification meaning |
|---|---|
| Source, reloaded-source and direct CIL | Independently measured and output-checked by this Node harness. Each ABI uses its own baseline. |
| Rectangular-array grid app | Included in all three startup paths; direct CIL requires the rectangular-array runtime/admission integration. A runtime failure remains a failure. |
| Portable snapshots | Measured only when the corresponding runtime APIs exist; fresh destination replay is mandatory when available. |
| Browser / native .NET | Not measured by this Node harness; separate browser and native reference evidence is required. |
| Optional Wasm tier | Explicitly disabled in this interpreter protocol. Wasm validation, bridge counts and native execution require their own qualification. |
| Source fusion target | The paired comparison in `bench/vm/source-fusion.js` reports the actual result and a 1.5× target predicate separately. This T12 gate does not convert a missed optimization target into a pass. |
| Cancellation / failure | Abort stops the current VM, terminates the sole child, removes temporary input and retains a failed/cancelled report. Such reports cannot qualify or pass. |

Runnable example programs are in `bench/vm/fixtures.js`; the actual virtual CIL assembly is in `bench/vm/virtual.js`. Performance acceptance remains attached to actual measured JSON and the exact tested revision.
