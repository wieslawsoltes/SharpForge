> Historical 0.2.0 interpretation. Its first raw run is retained in `il-benchmark-0.2.0.json`; runs 2/3 and summary are unchanged. The new 0.4 run is `il-benchmark.json`, summarized in [current validation](validation.md). These measurements use the original predecoded/profile engine, not the new direct-CIL VM.

# IL performance — SharpForge 0.2.0

Recorded 1 October 2026, Node v22.16.0, linux x64, AMD EPYC 9V74 80-Core Processor. Shared container, no CPU pinning or controlled host-GC state. Results are not browser typing-latency measurements, cold-process startup measurements, or comparisons with Roslyn, CoreCLR, Mono, native code or another compiler.

## Question: can the IL format keep execution speed?

It can preserve the existing **execution representation and hot loop**. The chosen path stores/transfers real CIL and decodes/verifies it into the same VM instructions once before execution. No IL decoder is inserted in instruction dispatch. The benchmark fixtures have identical results and VM instruction counts; the allocation workload also performs the same 30 explicit managed collections. This is an architectural explanation, not a guarantee of identical measured wall time.

Three complete runs were retained. Each uses 12 warmups for each execution path and 37 paired alternating-order measured runs per workload. VM construction and IL decoding are outside the execution timer. Debugger history is disabled. The original IR and IL-loaded IR use the same interpreter, resource checks and managed collector.

### Paired steady-state execution ratios

Each entry is the **median of paired IL-loaded time / original-IR time** within that run. A ratio of 1.000× is equal time; less than 1 is faster. The last column is the median of the three run medians, not an inferential confidence interval.

| Workload | VM instructions | Run 1 | Run 2 | Run 3 | Median of run medians |
| --- | ---: | ---: | ---: | ---: | ---: |
| integer loop | 580,018 | 0.993× | 0.989× | 1.005× | 0.993× |
| calls and arrays | 484,136 | 1.018× | 0.997× | 0.984× | 0.997× |
| allocation and collection | 186,138 | 1.148× | 1.019× | 0.968× | 1.019× |

The arithmetic/call runs cluster closely around parity. The allocation workload showed **14.8% slower time in the initial run**, 1.9% slower in run 2 and 3.2% faster in run 3. That first slowdown was not discarded. These measurements do not support promising exact equal performance on every engine/workload; host scheduling, JIT and JavaScript garbage collection can affect the retained object/array shapes and timing.

The pilot report has the same execution result/instruction/collection measurements but did not record allocation totals or raw pairs due to a statistics-field instrumentation mistake. Runs 2/3 fixed that instrumentation, retain every measured pair and check the actual allocation counter. All reports are preserved, and no compiler/runtime hot-loop modification was made between these measurement runs.

## Compilation and first module load are additional costs

Pipeline workloads contain ten generated files with approximately 1,000 or 10,000 simple assignment lines. Four warmup rounds precede 12 measured rounds. These are warmed JavaScript-process measurements of **fresh compilation/emission/loading**, not a cached module lookup. The table uses run 2 consistently rather than selecting the fastest value per stage.

| Workload | Full frontend/IR compilation | Additional PE/CIL emission | First decode + canonical verification | One-file edit analysis, no IL emission |
| --- | ---: | ---: | ---: | ---: |
| ~1,000 lines / 10 files | 4.65 ms | 4.30 ms | 12.20 ms | 1.40 ms |
| ~10,000 lines / 10 files | 39.00 ms | 33.31 ms | 101.56 ms | 11.92 ms |

The separately measured stage medians are not an end-to-end latency percentile and should not be summed and presented as one. Across the three runs, the ~10,000-line load median ranged from 88.81 to 101.56 ms. First launch still needs byte transfer, decoding/verification and VM construction; repeated identical launches reuse the decoded module. Cache lookup compares binary contents and is not a zero-cost operation.

Canonical verification re-emits the decoded program and compares all bytes. This deliberately costs time to enforce the narrow emission profile. It is not skipped on the IDE/runtime loading path. A broader, independently typed IL verifier/loader would be a separate engineering step, not an unverified fast path added to this release.

### Artifact size

For the generated ~10,000-line fixture: **2,240,512 bytes** of PE/CLI, of which **180,478 bytes** are CIL method bodies and **2,058,781 bytes** are metadata including verbose source/profile maps. The original JSON IR fixture is **1,498,827 bytes**. Thus this debug-rich IL artifact is **not smaller** than the old JSON image. The mapping stream contains no original executable IR, but source points, scopes and instruction-span entries are numerous. Binary/compressed profile maps and Portable PDB separation remain opportunities; they are not claimed as implemented optimizations.

## IDE latency policy

Ordinary editing/completion/diagnostic requests still call the frontend only. No PE emission or DLL load is added to those requests. A build emits the DLL. The runtime worker loads it independently from the compiler/UI worker. It keeps one decoded module and reuses it when subsequent launch bytes match, while each session receives new managed frames/statics/heap/history.

Unchanged source files retain their ASTs, but changed files are reparsed and binding remains compilation-wide. The IL backend does not change that into a fully incremental Roslyn-like compiler. Compiler bundle size/startup and browser interaction latency were not benchmarked here.

## Reproduction and raw evidence

```sh
npm ci --ignore-scripts --offline --no-audit --no-fund
mkdir -p artifacts/results
BENCH_REPORT=artifacts/results/my-il-benchmark.json npm run bench:il
```

The environment variable prevents overwriting the recorded pilot report. Script: `scripts/benchmark-il.js`. Inputs: `il-benchmark.json`, `il-benchmark-run2.json`, `il-benchmark-run3.json`. Aggregate: `il-benchmark-summary.json`. Raw pairs are included in runs 2 and 3. Historical pre-IL measurements remain in `performance.md` / `benchmark-results.json` and should not be substituted for current IL startup results.
