# A05 interpreter performance qualification (T12)

Implementation is staged; performance qualification is **unmeasured**. The checked-in baseline deliberately fails the gate until two complete, stable runs replace it. No baseline numbers, 5% repeatability result, native .NET comparison, or browser qualification are claimed.

## Run, in the sole validation queue

Wait until all E02 changes are assembled. Commit them before measurement. Use one otherwise idle, fixed runner, a fixed power mode, Node 24 with a 512 MB old-space cap, the same executable and flags, and no browser, native oracle, test, build, benchmark, or other validation process alongside this schedule. The harness creates at most one cold worker; it awaits that worker's exit before starting another. Warm cases are serial in the parent. Do not run two harness commands concurrently.

1. The queue owner runs correctness tests first, including `tests/a05-12-*.test.js`, with the repository's single-worker test configuration. Stop on failures.
2. Commit any corrections, then run the two commands below sequentially on that exact commit. These are complete interpreter runs; each includes 8 micro cases, 3 startup apps, and populated-heap snapshot copying, independently for source, reloaded source, and direct CIL.
3. Qualify the baseline only if every corresponding median differs by at most 5%. A noisy runner fails qualification; do not discard inconvenient samples or choose the faster repeat. Retain both complete JSON files. `--qualify` embeds the first report in the second.
4. Run the candidate on the same runner/options and compare. A different Node/V8 version, OS, CPU description, memory capacity, GC mode, locale, harness, fixture catalog, engine set, ABI, or measurement protocol requires a fresh baseline.

```sh
node --max-old-space-size=512 --expose-gc bench/vm/harness.js --runner dedicated-node24-01 --samples 100 --warmup 10 --out artifacts/a05-vm-first.json
node --max-old-space-size=512 --expose-gc bench/vm/harness.js --runner dedicated-node24-01 --samples 100 --warmup 10 --out artifacts/a05-vm-repeat.json
node scripts/perf-gate.js --qualify artifacts/a05-vm-first.json --repeat artifacts/a05-vm-repeat.json --out docs/performance/a05-baseline.json
node --max-old-space-size=512 --expose-gc bench/vm/harness.js --runner dedicated-node24-01 --samples 100 --warmup 10 --out artifacts/a05-vm-candidate.json
node scripts/perf-gate.js --baseline docs/performance/a05-baseline.json --candidate artifacts/a05-vm-candidate.json --out artifacts/a05-vm-gate.json
```

These are commands to execute later, not recorded execution evidence. The report records the real commit, full command, runtime versions, host fingerprint, harness hash, options, timestamps, every raw first/warmup/measured sample, correctness result and error. A dirty tree is rejected. Failed/cancelled reports cannot qualify or pass the gate. No automatic baseline replacement occurs during comparisons.

`--suite micro|startup|snapshot`, `--engine source|reloaded|cil`, and `--native-bits 32|64` select independent qualification sets. Defaults are all cases/engines and ABI32. ABI64 requires its own baseline JSON and the same sequential schedule. `--samples` accepts 20–10000; default 100 gives more tail information than the minimum, but p99 uncertainty is still reported statistically, not promised away. `--warmup` accepts 1–1000; default 10. The explicit runner name is required. All files under `bench/vm/` are harness contributions; changes invalidate its fingerprint.

## What is timed

| Case | Measurement boundary |
|---|---|
| Arithmetic, direct calls, fields, arrays, strings, exceptions, allocation | Prepared VM, restored initial snapshot and rebuilt invalidated plans outside the timer, complete guest execution inside it; raw first run and warmups retained alongside warmed median/p95/p99 |
| Virtual calls | Actual direct-CIL `callvirt` with a derived override, constructed through the public metadata/IL API; asserted override return value |
| Invoice, grid, text-report startup | A new Node child process for every observation; no warmup cache carried between observations |
| Load | CIL inspector parse; canonical source reload for reloaded engine; independent compiler-image copy for source |
| Verification | Explicit `verifyCilAssembly` or `verifyImage`; required constructor verification is also included in the separately measured construction interval |
| Predecode | `prepareExecution(vm)`: verified reachable CIL method plans, or source fusion-plan construction; no guest instruction executes |
| First output | Both execution-to-first-output and load-start-to-first-output, plus process-uptime-to-first-output and full child process wall time |
| Snapshot/copy | Populated 4096-element array at its first output; COW capture, same-VM restore, portable export, structured clone, fresh VM construction, and portable restore timed separately; replay output asserted |

Startup compilation occurs in the parent and is reported separately. Reading/deserializing the worker's artifact is recorded separately. Node/module loading is excluded from the four managed phases but included in process first-output and child wall time. Verification costs are not subtracted or hidden by a cache. The source engine's preparation is fusion planning over existing IR, not CIL decoding; the engine label must remain attached to the result.

CIL preparation uses the canonical method instances selected by calls, every cached closed generic context, and the exact method objects retained by active or parked frames after restore. Its `contexts` tuples contain the MethodDef token, closed owner and method arguments; `deferredMethods` identifies verified generic definitions without a known closed context. New dynamic generic instantiations can still require cold decoding. Warm measurements reject any sample that creates another decode/source plan or changes the code epoch inside the timer.

Instructions/sec uses actual VM instruction counters and measured wall time. Bounded cooperative slices include `setImmediate` scheduling between nonterminal slices. Managed allocation counts/bytes are exact VM counter deltas during execution; they exclude host graph and V8 allocations. Host RSS, heap-used/total, external and ArrayBuffer observations are separately labeled process gauges and are not called allocation totals or gated as such. Snapshot restore rewinds managed counters, so capture/restore does not report a bogus allocation delta. Fresh portable destination initialization allocations are retained separately. Exposed host GC, when available, runs before warm/snapshot samples outside their timers; VM managed GC remains part of execution.

## Gate definition

The gate recomputes statistics from raw measurements and rejects missing/duplicate cases, missing metrics, non-finite/negative samples, incomplete counts, failed correctness, incompatible environments/options, or unqualified baselines. Matching case status includes explicit unsupported entries. It preserves unsupported coverage instead of dropping it from a favorable result.

For each latency or managed-allocation metric (higher is worse) and throughput metric (lower is worse), the point degradation must exceed 5%, and the lower endpoint of a 95% two-sided bootstrap confidence interval must also exceed 5%. The baseline and candidate samples are resampled independently with replacement. The implementation uses a seeded percentile bootstrap of relative degradation, not a paired bootstrap and not SciPy's default BCa method. The method and independent-resampling semantics follow the [SciPy bootstrap documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html). Seed defaults to 12012 and resamples to 10000; both are included in results. Confidence is per metric, with no family-wise error claim. Comparisons below the point threshold are recorded without unnecessary resampling.

A zero allocation baseline uses an absolute increase without inventing an epsilon denominator; a positive increase must have a strictly positive interval lower endpoint. Zero throughput is invalid. The percentile method handles equal-valued samples without fabricating variance; noisy or small tail samples can leave a change inconclusive. Reports retain median/p95/p99 even when a gate outcome is inconclusive. Exit codes: 0 comparison passed or baseline qualified; 1 significant regression; 2 malformed/incompatible/unqualified evidence.

## Capability and limits

| Capability / target | Status |
|---|---|
| Public `prepareExecution(vm)` from `@sharpforge/runtime` | Staged API; prepares plans without advancing guest instructions; returns engine/method count/cache statistics. Rejects foreign/stopped/malformed VMs. Source fusion disabled returns explicit unsupported. |
| Source / reloaded / direct-CIL benchmark execution | Implemented, qualification deferred until full E02 integration |
| Source/reloaded virtual dispatch | Unsupported in this fixture: source IR cannot represent its polymorphic `callvirt`; ordinary calls are measured separately |
| Portable copy and replay | Implemented across the three engines; positive replay checks, qualification deferred |
| Browser / native .NET measurements | Unsupported by this Node harness; existing browser/native acceptance runs are separate evidence |
| Optional Wasm tier | Explicitly disabled in this interpreter baseline; `prepareWasmTier` and native/bridge counters require a separate qualification protocol |
| Cancellation / failure | SIGINT/SIGTERM abort serial work, stop VMs, terminate the sole child, remove temporary input, write a failed/cancelled report; never qualifies |

The runnable examples are the fixture programs in `bench/vm/fixtures.js` and the actual CIL virtual assembly in `bench/vm/virtual.js`. Focused regression tests cover deliberately slowed interpreter execution, noise, zero-allocation boundaries, malformed or mismatched reports, unsupported cases, cancellation and disposal. They are prepared, not run in this implementation slice.

The deliberately slowed-handler integration test is queued with `node --max-old-space-size=512 --test --test-concurrency=1 --test-name-pattern="deliberately slowed arithmetic" tests/a05-12-harness.test.js`. It measures the actual source interpreter with a test-only arithmetic-handler delay and applies the bootstrap to measured samples. Synthetic report tests only exercise gate/schema behavior and are never native or performance evidence. Run this command only in the sole validation queue.
