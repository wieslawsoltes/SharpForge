# Slot and virtual-call qualification at 48c62243

These unchanged CIL fixtures ran sequentially from clean revision
`48c62243ef4cf614dfcafdb7af9a7ce360b643c4` on Linux x64, Node 24.19.0,
V8 13.6.233.17-node.51, and a 64-bit guest native ABI. Both reports record the
same clean revision before and after measurement, verified output for every
observation, and no execution errors. The JSON and logs are copied byte for byte;
`manifest.json` records their sizes and SHA-256 hashes.

| Target | Measured pairs | Observed result | 95% paired interval | Required | Outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| `virtual-cache` (#1391) | 20 | 2.153884× | 1.835978–2.521246× | ≥3× | Missed |
| `scalar-slot-loads` (#1398) | 100 | 71.68599% reduction | 70.38037–72.61628% | ≥30% reduction | Met |

The scalar comparison uses nanoseconds per guest instruction. It compares
`scalarSlotLoads: false` with `true`, including the guarded direct stores enabled
by that existing flag. The virtual comparison changes only `inlineCaches`; both
modes retain scalar-slot optimization. All other fixture, reference, and threshold
settings remain unchanged. Each mode retains its first observation and three
warmup observations separately, excluded from summaries. Measured pairs alternate
execution order with exposed host GC before each complete observation. Intervals
use the harness's seeded 10,000-resample paired percentile ratio of medians.

| Target and mode | Median execution (ms) | p95 (ms) | p99 (ms) | Guest instructions |
| --- | ---: | ---: | ---: | ---: |
| Virtual reference | 409.816801 | 509.070269 | 545.346759 | 280,014 |
| Virtual candidate | 190.268705 | 261.110496 | 293.299524 | 280,014 |
| Scalar reference | 1,116.439176 | 1,509.796322 | 1,586.325717 | 780,006 |
| Scalar candidate | 316.108715 | 467.150402 | 525.885334 | 780,006 |

Scalar reference median/p95/p99 were 1,431.321267/1,935.621421/2,033.735276
nanoseconds per instruction; candidate values were
405.264465/598.906164/674.206780. Every measured scalar observation allocated
zero managed objects, frames, and frame arrays in both modes. Every measured
virtual observation allocated one 32-byte managed receiver and zero new frames
or frame arrays in both modes. These exact runtime counters do not count host
JavaScript allocations. Process memory gauges in the reports are not allocation
totals and do not establish a zero-host-allocation claim.

The harness reports `nativeQualification: false`: these are same-host JavaScript
VM results, not native-platform, browser, or cross-machine qualification. The
100-pair scalar result resolves the earlier 20-pair interval that crossed the
30% boundary. The virtual target remains open; this report does not supersede its
3× requirement or qualify any other Project 7 target.

## Exact execution and environment

The repository's machine-wide limiter launched both commands with one permitted
run, one test worker, and a 512 MB old-space cap. Commands ran from the unchanged
qualification checkout above. The JSON's `command` records the child invocation;
the complete wrapper invocations were:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/limited.js node --expose-gc \
bench/vm/qualification.js --runner a05-linux-x64-node24 --native-bits 64 --suite targets \
--target virtual-cache --out /workspace/scratch/42f7738360b9/a05-virtual-48c62243.json

SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/limited.js node --expose-gc \
bench/vm/qualification.js --runner a05-linux-x64-node24 --native-bits 64 --suite targets \
--target scalar-slot-loads --samples 100 --out /workspace/scratch/42f7738360b9/a05-slots-48c62243.json
```

The virtual run completed at `2026-10-04T14:51:02.721Z` and returned status 1
because it missed the target. The scalar run completed at
`2026-10-04T14:54:12.727Z` and returned status 0. No competing SharpForge test,
build, benchmark, or profiler job was present during these sequential runs.
An unrelated `/site` development server and workerd process remained running;
process checks showed low cumulative CPU activity, but this was not an entirely
idle or dedicated host. The unrelated processes were not altered. Full CPU,
runtime, locale, fingerprint, fixture hashes, VM options, raw observations,
construction costs, and warmup observations remain in the JSON reports.
