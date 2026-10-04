# Root visitor and profiler qualification, 2026-10-04

The unchanged 500-frame root visitor target (#1400) passed in both JavaScript
engines. The profiler-off target (#1402) did not pass: CIL arithmetic and
allocation exceeded the strict 1% overhead threshold, while the remaining four
intervals crossed it. All twelve profiler rows completed with verified program
output and matching guest instruction counts; enabled rows also verified every
guest instruction was profiled. Execution success does not establish acceptance.

Raw JSON and logs are copied byte for byte. `manifest.json` records their sizes,
SHA-256 hashes, wrapper settings, process exit codes, and completion checks.
Neither report qualifies native platforms, browsers, or other runtime revisions.

## Revisions and reference isolation

Roots ran on clean `5909d54f25ef9898c956c736c96db782e36978ff`. Profiler measurements
ran on clean product `9344fe8cb43a9198e618367525395a840cd7baa3`, whose runtime,
qualification fixtures, options, and thresholds are unchanged from that parent.
The only implementation changes fix reference dependency setup and its tests.
Both reports record identical clean start and completion revisions, and no
execution errors.

The profiler reference is committed as
`a21338c73b278d733434bb51444a16a9ebd29dac`, directly descended from the measured
product. Its exact patch, changed-file hashes, dependency inventory, sparse
patterns, and transform hash are retained in
`a05-profiler-reference-9344fe8cb.json`. The patch SHA-256 is
`433c78d0554f28aa2cecec82b092a8f848d5bfe8047b5cf23eeea55a3d7a8a15`.
The product and parent runtime tree are both
`c4fef830e2ab6199e1f4a573e98442f5a9f8c1b9`. The separate reference's cleanliness
and revision were checked again after the measurement completed.

An initial reference setup at 5909 failed before timing began because a whole
`node_modules` directory symlink was untracked under Git's directory ignore rule.
Its failure log is retained. The committed fix uses a real directory containing
recorded dependency links and validates every entry. It does not filter status
output or weaken cleanliness checks. Twelve focused tests passed, including
actual execution through the reference's distinct public runtime entry point.

This historical reference removes the reviewed profiler consumers present at
9344. Later main changes make allocation notifications a shared host-observer
contract. A future reference must preserve that contract; the recorded reference
and results here have not been rewritten to describe later code.

## Root visitor result

Each engine constructed 500 actual frames with 32 Int32 locals and one live
reference per frame. Each observation scanned the complete inventory 20 times.
The comparison changes `preciseRoots: false` to `true`, retains
`preciseRootLiveness: false`, verifies equal root inventories, and performs
post-timing managed collections. The separate dead-reference liveness tests are
not measured by this fixture.

| Engine | Speedup | 95% paired interval | Required | Outcome |
| --- | ---: | ---: | ---: | --- |
| Source | 3.397571× | 3.326203–3.482088× | ≥3× | Met |
| CIL | 3.343396× | 3.253705–3.506038× | ≥3× | Met |

Times below are milliseconds for all 20 scans in an observation.

| Engine/mode | Median | p95 | p99 |
| --- | ---: | ---: | ---: |
| Source generator | 48.764042 | 69.926277 | 79.327830 |
| Source visitor | 14.352619 | 19.573378 | 23.452884 |
| CIL generator | 51.219824 | 77.075655 | 80.076725 |
| CIL visitor | 15.319700 | 25.720313 | 27.794965 |

## Profiler result

Required profiling-off rows compare the product against its reviewed hook-free
reference. Enabled rows separately compare profiling enabled with product
profiling off. An omitted option is not used as a hook-free baseline. Negative
point estimates indicate the product happened to measure faster; confidence
intervals still determine acceptance.

| Required off row | Overhead | 95% interval | Outcome | Enabled overhead, reported only |
| --- | ---: | ---: | --- | ---: |
| Source arithmetic | 1.133205% | 0.232644–1.658977% | Inconclusive | 70.747288% |
| Source calls | 0.793555% | −0.716670–2.742990% | Inconclusive | 48.151457% |
| Source allocation | −1.141819% | −6.243606–2.339999% | Inconclusive | 49.490829% |
| CIL arithmetic | 7.313483% | 4.100764–11.229420% | Missed | 13.290974% |
| CIL calls | −0.529031% | −4.171133–2.006168% | Inconclusive | 11.332512% |
| CIL allocation | 5.469887% | 2.462200–9.588483% | Missed | 7.911019% |

| Required off row | Reference median/p95/p99 (ms) | Product median/p95/p99 (ms) |
| --- | --- | --- |
| Source arithmetic | 17.398354 / 27.198904 / 29.727112 | 17.595513 / 20.060874 / 26.610141 |
| Source calls | 63.349954 / 91.683696 / 101.205213 | 63.852670 / 87.549007 / 96.224172 |
| Source allocation | 84.397721 / 128.804530 / 131.659935 | 83.434052 / 123.697519 / 134.782847 |
| CIL arithmetic | 148.813976 / 197.868180 / 222.179356 | 159.697461 / 211.941867 / 220.750250 |
| CIL calls | 514.834487 / 637.047577 / 752.076259 | 512.110856 / 622.210982 / 683.691260 |
| CIL allocation | 1505.731457 / 1850.833825 / 1934.891740 | 1588.093261 / 2038.754548 / 2114.027626 |

The reports retain all cold construction/preparation costs, first observations,
warmups, measured observations, enabled timings, and managed/frame allocation
counters. Host-memory gauges do not count JavaScript allocations. These results
do not establish any zero-host-allocation claim.

## Protocol and exact commands

Both suites use 100 measured pairs, 10 warmup pairs, an additional excluded first
pair, alternating order, and exposed host GC before each observation. Intervals
use 10,000 seeded paired bootstrap resamples (seed 12012, confidence 95%). Workloads
and thresholds were unchanged. The profiler uses the existing 20,000-iteration
arithmetic, call, and allocation fixtures, 64-bit guest native integers, and a
256-sample profile budget when enabled. All options and assembly hashes are in
the reports.

The host was Linux x64, Node 24.19.0, V8 13.6.233.17-node.51, AMD EPYC 9V74.
No competing SharpForge test/build/benchmark ran during these serial jobs; other
unrelated system services were not stopped. This was a shared host, not a
dedicated performance machine. The old report schema does not fingerprint the
inherited `NODE_OPTIONS` or effective V8 heap limit. The exact wrapper environment
is retained here; a subsequent schema improvement must not alter this evidence.

Commands ran from `/workspace/scratch/42f7738360b9/a05-performance` at their pinned
revisions. The complete wrapper, also used for reference creation and validation,
was:

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --expose-gc bench/vm/qualification.js \
--runner a05-linux-x64-node24 --suite roots --samples 100 --warmup 10 \
--root-scans 20 --native-bits 64 --timeout-seconds 900 \
--out ../a05-roots-5909d54f2-attempt1.json

SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --expose-gc bench/vm/qualification.js \
--runner a05-linux-x64-node24 --suite profiler --samples 100 --warmup 10 \
--native-bits 64 --timeout-seconds 1800 \
--profiler-reference ../a05-profiler-reference-9344fe8cb.json \
--out ../a05-profiler-off-9344fe8cb-attempt1.json
```

The profiler completed at `2026-10-04T16:08:37.897Z`, returned exit code 1 because
acceptance was missed, and reported `status: measured`, `acceptance: missed`.
The root suite returned exit code 0 and reported `acceptance: met`.
