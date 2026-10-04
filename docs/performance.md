> The historical raw frontend report is retained in `benchmark-results-0.2.0.json`. Current 0.4 measurements are in `benchmark-results.json` and [current validation](validation.md).

> Historical SharpForge 0.1 frontend/VM measurements. For the 0.2 IL backend, cold-loading costs, all three paired execution runs and interpretation, see [IL performance](il-performance.md).

# Recorded performance measurements

This report describes the included code measured locally. It does not establish state-of-the-art performance, predict every browser/device, or compare against Roslyn, V8 JavaScript execution, Wasm or the CLR.

## Environment and method

Recorded: 2026-10-01T18:38:06.063Z. Node v22.16.0, linux x64, AMD EPYC 9V74 80-Core Processor. The container exposed 5 logical CPUs; this is shared host information, not a guaranteed CPU allocation. Benchmarks themselves run synchronously in one Node process.

Single-process warm microbenchmarks in a shared Linux container. Wall-clock milliseconds, external performance.now(). No forced JS GC, no network, no browser rendering. Not conformance or comparative compiler measurements.

Each workload uses five warmups followed by 15 or 25 timed observations. The unchanged-result workload batches 1,000 lookups per timed observation; its very small per-call figure is not meaningful compilation latency. There is no forced host GC, and p95 can include runtime scheduling or host-GC variation.

## Results

| Workload | Median (ms) | p95 (ms) |
| --- | ---: | ---: |
| full parse + bind + emit: particle project | 0.6800 | 1.0284 |
| full parse + bind + emit: approximately 1K lines | 4.3551 | 6.2146 |
| full parse + bind + emit: approximately 10K lines | 43.5349 | 53.3172 |
| unchanged workspace result cache lookup | 0.0001 | 0.0001 |
| one-file edit in approximately 10K-line workspace | 10.3974 | 11.6284 |
| VM: 10,000-iteration integer loop | 3.4106 | 13.5239 |
| GC: trace and sweep 10,000-object chain | 4.3826 | 12.5534 |

The small project has two source files. The larger generated programs use many straightforward integer assignments and a small number of methods; they are not representative of generics, overload-heavy code, large real solutions, malformed interactive edits or the full C# language.

The one-file-edit benchmark reparses only the changed source file but rebinds and re-emits the entire compilation. Cached lookup returns the exact previous result object. The VM benchmark includes image verification and VM construction but excludes source compilation and browser UI. The GC workload includes object allocation, tracing a live chain and sweeping it after dropping the root; it is not a pause-only measurement.

The 10,000-iteration VM loop executes 210,021 bytecode instructions. Per-instruction throughput depends heavily on the operation mix; it must not be generalized to all C# execution.

## Reproduce

```sh
npm install --ignore-scripts --offline --no-audit --no-fund
npm run bench
```

The script writes `artifacts/results/benchmark-results.json` (or `SHARPFORGE_RESULTS_DIR`). Keep the environment and raw JSON when comparing changes. Run multiple processes on an idle target machine and use real edit traces before setting performance gates.

## Present bottlenecks

Changed-file lexing/parsing is not edit-local. Semantics/emission are compilation-wide. The main-thread editor performs full small-file highlighting. The interpreter has no optimizing JIT. The managed heap uses JS-backed records with logical byte accounting. Snapshot copies add work when debugging. None of these costs is hidden behind a claim that worker isolation makes the underlying work free.
