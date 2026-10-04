# Exception leave measurements

[Raw chronological samples and exact historical harnesses](eh-leave-node24.json)
record the parent `c652049f`, product `41bb6e3d` and harness `329b90b2`.
Node 24.21.0, macOS arm64, Apple M3 Pro; shared host. Every job ran serially
through `scripts/limited.js`, with both concurrency settings set to 1.
The synthetic workload checks lexical EH only, not executable stack correctness.

| Ordinary branch control | Before median / p95 ms | After median / p95 ms |
| --- | --- | --- |
| Initial, 1,000 clauses | 2.641833 / 2.855166 | 2.805291 / 3.605792 |
| Initial, 10,000 clauses | 13.152000 / 15.757792 | 15.528042 / 23.077917 |
| Confirmation, 1,000 clauses | 2.678646 / 2.993500 | 2.629938 / 2.942459 |
| Confirmation, 10,000 clauses | 15.582042 / 17.758000 | 16.572792 / 18.103834 |

Initial separate processes used 10 warmups and 15 samples. One fixed interleaved
confirmation used 30 warmups per revision and 20 pairs, alternating AB/BA, with
GC and one validation per sample. No product tuning occurred between captures.
The confirmation retains a +0.990750 ms (+6.36%) 10k median increase. It does not
erase the initial measurements or establish causality, noise or significance.

CIL reviewer `/root/cil_a03` explicitly accepted both sets, including the initial
10k p95 increase of 7.320125 ms, for the shared validation seam and complete
opt-in leave checks. Source review found no extra decoding, leave-index
construction or per-instruction allocation in the existing branch-only API.
No speedup claim is made.

| New full validator | Median / p95 ms | Median sampled heap delta, bytes |
| --- | --- | --- |
| 1,000 clauses | 3.201500 / 4.153667 | 2,475,736 |
| 10,000 clauses | 24.405917 / 42.921750 | 26,086,448 |

Heap deltas are not allocation totals, retained heap or peak RSS. The new API
has no historical equivalent. Broader engine qualification remains staged.

## Reproduction

The published harness now uses a static package entry-point import to satisfy
the dynamic-code gate. This import-only adjustment was not rebenchmarked. Run:

```sh
export SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-eh-leave.mjs validateExceptionBranches
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-eh-leave.mjs validateExceptionControlFlow
```

For the parent control, extract `git archive c652049f packages/cil` to an isolated
folder, copy the published harness into its `packages/cil/tools`, and run its
branch mode through the current checkout's limiter. No full baseline worktree
is required. For the exact historical captures, extract the two harness strings
from the JSON artifact and preserve their recorded arguments and source paths:

```sh
SF_BENCH_REVISION=c652049f node scripts/limited.js node --expose-gc /tmp/eh-leave-historical.mjs /tmp/sharpforge-eh-leave-baseline/packages/cil/src/eh-branches.js validateExceptionBranches
SF_BENCH_REVISION=329b90b2 node scripts/limited.js node --expose-gc /tmp/eh-leave-historical.mjs /tmp/sharpforge-project6-a03-eh-leave/packages/cil/src/eh-branches.js validateExceptionBranches
SF_BENCH_REVISION=329b90b2 node scripts/limited.js node --expose-gc /tmp/eh-leave-historical.mjs /tmp/sharpforge-project6-a03-eh-leave/packages/cil/src/eh-leave.js validateExceptionControlFlow
node scripts/limited.js node --expose-gc /tmp/sharpforge-eh-leave-interleaved.mjs
```

The retained historical harness takes a module path; the published harness takes
only the operation name. Initial p95 is sample 15 of 15; confirmation p95 is
sample 19 of 20, and its median averages samples 10 and 11.
