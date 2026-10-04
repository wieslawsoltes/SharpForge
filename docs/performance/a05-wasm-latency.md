# Wasm preparation and complete-call latency

Parent [#84](https://github.com/wieslawsoltes/SharpForge/issues/84) requires:

> Measure cold/warm latency, p95/p99 and allocations for performance-sensitive paths; keep correctness gates.

`bench/vm/wasm-latency.js` adds this measurement independently of T12 and the
numeric, dispatch, root and profiler targets. It introduces no speedup threshold.
The existing OSR fairness workload continues to measure the actual selected OSR
path; this report measures automatic compiled **call entry**.

Run from a clean committed checkout, on a quiet machine, through the resource
limiter. Save each attempt to a new path; the driver refuses to overwrite an
existing report.

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 \
SHARPFORGE_TEST_CONCURRENCY=1 \
SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --expose-gc bench/vm/wasm-latency.js \
  --runner a05-linux-x64-node24 --native-bits 64 \
  --samples 100 --warmup 10 --timeout-seconds 900 \
  --out /tmp/a05-wasm-latency-attempt1.json
```

The CLI accepts 20–1,000 samples and 1–100 warmups. Both fixed fixtures execute
1,024 iterations: integer addition/control flow, and the same loop with boxing
and unboxing on every iteration. They are built through the public CIL metadata
and assembly APIs. Fixture construction and an interpreter oracle are outside
the measured phases. Every run must return exactly 1,024, emit no output and
execute its exact prescribed CIL instruction count. The boxing run must allocate
exactly one managed box per iteration; compiled allocation bytes must equal the
interpreter oracle.

| Phase | Timer and allocation scope | Reuse |
| --- | --- | --- |
| Cold preparation | Before VM construction through one compiled method becoming ready; separate construction, post-construction preparation and total latencies | Fresh VM and runtime caches for every observation |
| Interpreted priming | The initial call admitted before readiness executes completely; retained separately | No compiled selection, no hidden guest work in cold preparation |
| First compiled call | Fresh entry admission through complete termination | First compiled execution for each fresh VM |
| Warm compiled call | Fresh entry admission through complete termination | One final VM retains the compiled method, metadata caches and pooled storage; no restore or invalidation |

Cold preparation includes verification, eligibility analysis, IR construction,
Wasm encoding and asynchronous native instantiation. The initial frame must
execute **zero** instructions before readiness. These are **VM-cold observations
within one Node process**, not fresh-process startup observations; the host
engine's native code cache is not reset. The first observation and configured
warmups remain in the raw evidence and are excluded from each phase summary.

Every compiled observation requires one selected call, selection for its entire
guest instruction count, positive compiled byte size, no additional compilation
and no OSR transition. Selected instructions include the runtime's canonical
imported helpers; they are not a count of wholly native operations. A separate
correctness probe replaces the interpreter binary-operation hook with a throwing
function and completes the same call successfully. This proves the arithmetic
actually executes in Wasm. A missing or rejected Wasm backend fails the report;
interpreter fallback cannot produce a successful compiled timing row.

Raw observations include exact managed allocation count/bytes, frame and frame
array allocations, and offset-map allocations. Cold counters start from zero
before construction. Compiled-call counters include entry admission. The report
retains linear-interpolated p50/median, p95 and p99 for latency and these allocation
counters. Encoded `compiledBytes` reports code size, **not native code-memory
allocation**. Process RSS, heap, external and array-buffer values are gauges;
they do not measure total JavaScript allocations or native compiler allocations.
Those totals remain unavailable from these counters.

Reports include the exact command, Git revision before/after, clean-worktree
checks, harness and assembly hashes, Node/V8 versions, machine/resource settings,
raw backend counters and disposal state. Compilation and execution errors retain
partial rows. VMs and tier selections are disposed on both success and failure.
An exit code of zero means the observations completed with their correctness and
backend checks; it does not mean Wasm is faster than the interpreter.

`tests/a05-wasm-latency.test.js` exercises both real compiled fixtures, exact
counter/phase boundaries, backend refusal and cancellation. Authoring validation
is syntax and diff checking only; runtime tests and the actual latency report
remain pending the serial validation slot. No performance result is claimed by
adding this harness.
