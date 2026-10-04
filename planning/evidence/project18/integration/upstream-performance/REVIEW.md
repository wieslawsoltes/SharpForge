# Integrated runtime performance review

Status: **performance budget review remains open**. All benchmark correctness outputs passed.

The unchanged release14 benchmark ran in two alternating baseline/integration pairs with Node 22.23.3 on Linux x64. Each process performed one cold and four warm samples per workload and engine, giving eight warm samples per row and tree. Processes ran serially through the repository limiter. The baseline was `b34fa27b7812a62f8c10cf81c83d2cbfdd0b347a`; the integrated runtime was `c1a662d18d31e202a6b420bce1e9177b0b1a50ba`. The relevant source directories remain byte-identical at `e8f1502379a2635d4cf448c86ad552298404ef53`.

| Workload | Engine | Baseline median (ms) | Integrated median (ms) | Median change | p95 change |
|---|---|---:|---:|---:|---:|
| dictionary | source | 36.924 | 40.860 | +10.66% | -4.89% |
| dictionary | cil | 126.623 | 170.185 | +34.40% | +50.94% |
| list | source | 52.846 | 53.526 | +1.29% | -12.45% |
| list | cil | 368.349 | 377.525 | +2.49% | -2.46% |
| queue | source | 22.254 | 23.247 | +4.47% | +2.42% |
| queue | cil | 141.744 | 153.686 | +8.42% | -10.24% |
| builder | source | 25.070 | 23.517 | -6.19% | +30.07% |
| builder | cil | 66.403 | 62.539 | -5.82% | -9.08% |

These are complete-tree measurements on a shared host under resource pressure. They do not isolate an individual commit or measure graph loading. The managed allocation counter is identical for every compared workload; JavaScript heap allocation was not measured. Raw samples, process timestamps, arguments and stderr are preserved in [benchmark.json](benchmark.json) and its linked files.

## Diagnosis and limits

Four bounded dictionary CIL CPU profiles per tree sampled only the execution interval after construction, with a 100-microsecond sampling interval. Correctness remained intact. The instrumented integration runs were faster: inclusive runCilSlice samples totaled 503,544 microseconds versus 591,242 for baseline; runtimeTypeName totaled 41,140 versus 49,568. Frame flush and GC sampled times also decreased. These profiles do not establish a causal regression, and they do not cancel the slower unprofiled benchmark results.

The read-only source audit found that the core dispatch, ordinary call/field/intrinsic/generic handlers and collection algorithms retained the reviewed upstream paths. Primitive dictionary keys do not exercise the initially suspected object-comparer route. There is no measured basis for a speculative runtime edit. Both the regression samples and the counterevidence are retained in [assessment.json](assessment.json).

The dictionary source/CIL and queue CIL medians exceed the 5% contribution threshold. The performance section of [CONTRIBUTING.md](../../../../../../CONTRIBUTING.md) therefore still requires explicit justification and PR sign-off. This evidence does not claim performance acceptance, platform-wide qualification or a speedup.
