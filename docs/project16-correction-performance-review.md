# Studio correction boundaries: measured cost and review acceptance

Both matched Node captures passed their correctness and cleanup assertions. The
comparison **retains exit code 2 and `reviewRequired: true`**: three of four cases
exceed the unchanged 5% review threshold, across five of eight median/p95 metrics.
The separate report/parser harness run passed **7/7 tests**, with no failures or
skips. These test results are not added to other completed-scope totals.

The root integration reviewer (`/root`) **explicitly accepts the observed
correctness costs** in this candidate: compiler eligibility checks prevent
unsupported project sources from crossing the language/compiler boundary, and
native timer adapters preserve the correct host receiver during runtime activity
and chord cancellation. This is integration review acceptance, not human/user
approval or a 5% performance-budget pass. It does not attribute every timing
difference to an individual source change. Follow-up core, post-merge main core
and hosted qualification remain pending at this archival boundary.

## Exact capture identity

One baseline followed by one candidate ran on the same **shared host** on
2026-10-04. The retained run spans 05:59:03.214183–05:59:09.756606 UTC, including
comparison. Neither capture was repeated for a better outcome.

| Capture | Source revision | Source tree |
|---|---|---|
| Baseline | `c13aa0fd9d27df28b3708bb83d914a04c20a5c7c` | `29023ed8b962b6d91671bdb0c0359d905ef2659e` |
| Candidate | `e89257052957f4c736512e9c2b46162bb6f23eae` | `9e33eca9a91361201b2e14fea3cded5cbd584d88` |

Both used Node **v24.19.0**, V8 **13.6.233.17-node.51**, Linux x64, an AMD EPYC
**9V74 80-Core Processor**, nine exposed logical CPUs, no `execArgv` options and
`NODE_OPTIONS=--max-old-space-size=2048`. The actual executable was
`/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node`.
The three-module harness SHA-256 was identical:
`cfd2b13e84cd5fcadccfb242b762875634e19c224a2867413c802565863ca27d`.
Individual module hashes and all 28 relative public-package entry paths are
preserved in both captures.

## All measured cases

Times are **milliseconds per operation derived from batch durations**. Every
median and p95 below is displayed exactly after dividing the reported nanoseconds
by one million; percentages are rounded to three decimals for display. Flags use
the full-precision comparison. These p95 values describe normalized batches,
not individual-call latency tails.

| Case | Baseline median ms | Candidate median ms | Delta ms | Delta % | Above 5% |
|---|---:|---:|---:|---:|---|
| Snapshot, 1 source | 0.0039899609375 | 0.0049275078125 | +0.000937546875 | +23.498 | **Yes** |
| Snapshot, 100 sources | 0.184922921875 | 0.22593146875 | +0.041008546875 | +22.176 | **Yes** |
| Runtime start/schedule/stop | 0.0034243828125 | 0.0035076328125 | +0.00008325 | +2.431 | No |
| Chord prefix/cancel | 0.0017773671875 | 0.0024505703125 | +0.000673203125 | +37.876 | **Yes** |

| Case | Baseline p95 ms | Candidate p95 ms | Delta ms | Delta % | Above 5% |
|---|---:|---:|---:|---:|---|
| Snapshot, 1 source | 0.0174626640625 | 0.01022083984375 | -0.00724182421875 | -41.470 | No |
| Snapshot, 100 sources | 0.345697390625 | 0.43807409375 | +0.092376703125 | +26.722 | **Yes** |
| Runtime start/schedule/stop | 0.007372484375 | 0.007123125 | -0.000249359375 | -3.382 | No |
| Chord prefix/cancel | 0.00288810546875 | 0.0031916875 | +0.00030358203125 | +10.511 | **Yes** |

The review explicitly accepts the 100-source snapshot's **+0.041008546875 ms
median / +0.092376703125 ms p95**, the single-source snapshot's
**+0.000937546875 ms median**, and chord handling's **+0.000673203125 ms median /
+0.00030358203125 ms p95**. Lower measurements in other cells do not offset or
remove those flags. The runtime case stays below this pair's review threshold;
that observation is not a statistical non-regression proof.

## Samples, correctness and cleanup

Each case retains **101 measured batches**, ten warmup batches and a separate
first-operation observation. The one-source snapshot, runtime and chord cases
use 256 operations per batch; the 100-source case uses 64. Per capture, this is
404 measured batches containing 84,032 timed operations, plus 40 warmup batches
containing 8,320 operations and four first operations. These are three separate
cohorts; the summaries include only the 101 measured batches per case.
Nearest-rank positions are 51 for the median and 96 for p95.

| First-operation observation | Baseline ms | Candidate ms |
|---|---:|---:|
| Snapshot, 1 source | 0.548136 | 0.744223 |
| Snapshot, 100 sources | 0.994159 | 1.228092 |
| Runtime start/schedule/stop | 0.609199 | 0.696080 |
| Chord prefix/cancel | 0.362346 | 0.329216 |

These first observations can include initial lazy source materialization; they
are not cold process or Studio startup measurements. All warmup timings remain
in the raw JSON. Snapshot fixtures contain exactly 1,024 ASCII/UTF-16 units per
source, real model-backed lazy records and explicit project membership. Every
batch validates its last result, including all source texts, URIs, versions,
compilation options and diagnostics. Fixture/correctness hashes match across
the pair; both captures report empty failure lists.

Default native timers are used without patched globals or injected clocks.
Operations cancel synchronously; an untimed event-loop turn checks subsequent
state and callback assertions. All **32 native `Timeout` observations** across
the pair are zero: before work, after operations, after the untimed turn and
after disposal for each case. No managed worker pump or timed wait executes.
Imports, fixture/project construction, assertions, hashing, cleanup verification
and output serialization remain outside the measured intervals.

The independent read-only arithmetic audit recomputed all reported median/p95
values and deltas from the retained samples, checked source/tree and harness
identities, and confirmed the three case/five metric flags. No benchmark,
test, build or browser was rerun while preparing this archive.

## Commands and retained evidence

The following commands ran from the integration checkout. Exact argument arrays,
timestamps, exit codes and log names are preserved in
[run.json](evidence/project16-a5-boundary-benchmark/capture/run.json):

```sh
node scripts/limited.js node \
  /workspace/scratch/6b99131ca908/p16-integration/scripts/benchmarks/a19-correction-paths.mjs capture \
  --checkout /workspace/scratch/6b99131ca908/p16-master-status \
  --output /workspace/scratch/6b99131ca908/p16-integration/artifacts/results/p16-a5-boundary-benchmark/baseline.json
node scripts/limited.js node \
  /workspace/scratch/6b99131ca908/p16-integration/scripts/benchmarks/a19-correction-paths.mjs capture \
  --checkout /workspace/scratch/6b99131ca908/p16-integration \
  --output /workspace/scratch/6b99131ca908/p16-integration/artifacts/results/p16-a5-boundary-benchmark/candidate.json
node scripts/limited.js node \
  /workspace/scratch/6b99131ca908/p16-integration/scripts/benchmarks/a19-correction-paths.mjs compare \
  --baseline /workspace/scratch/6b99131ca908/p16-integration/artifacts/results/p16-a5-boundary-benchmark/baseline.json \
  --candidate /workspace/scratch/6b99131ca908/p16-integration/artifacts/results/p16-a5-boundary-benchmark/candidate.json \
  --output /workspace/scratch/6b99131ca908/p16-integration/artifacts/results/p16-a5-boundary-benchmark/comparison.json
node scripts/limited.js node --test tests/a19-correction-benchmark.test.js
```

The separate harness test ran at the same candidate source/tree from
05:58:25.804977 to 05:58:26.118089 UTC; its runner duration was 111.129886 ms.
Its [summary](evidence/project16-a5-boundary-benchmark/harness/summary.json) and
[log](evidence/project16-a5-boundary-benchmark/harness/harness.log) retain 7 passed,
0 failed, 0 canceled, 0 skipped and 0 todo. This verifies report/parser and
threshold behavior, not browser or full product acceptance.

The [SHA-256 manifest](evidence/project16-a5-boundary-benchmark/manifest.json)
covers **nine unchanged raw files, 36,108 bytes**: the
[baseline](evidence/project16-a5-boundary-benchmark/capture/baseline.json),
[candidate](evidence/project16-a5-boundary-benchmark/capture/candidate.json),
[comparison](evidence/project16-a5-boundary-benchmark/capture/comparison.json),
three command logs, run metadata and the two harness-test files. Copies were read
back and compared byte for byte. The comparison remains `comparable: true`,
`reviewRequired: true`, exit 2; capture commands remain exit 0.

## Source disclosure and limits

Both tracked source trees were clean and stable during capture. The baseline
also contained two disclosed untracked documentation/test files. The candidate
contained one untracked CLR metadata module and eight syntax-matrix fixture
files. Their complete paths remain in each raw report and the manifest. The
harness verified that its direct imports/public entries were tracked and that
workspace package resolution stayed inside the selected checkout; it did not
claim the entire checkout contained no other files or recursively attest every
possible module. No other agent's files were deleted or included as benchmark
source changes.

This is one ordered pair on a shared host. JIT, GC, scheduling, CPU frequency and
run order can affect these short observations. No confidence interval,
statistical causality, measured speedup, browser latency, individual-call tail,
allocation or retained-memory conclusion is drawn. The experiment measures the
eligible snapshot and native timer boundaries in the complete candidate; it
does not establish oversized-source performance or isolate every change's cost.

Earlier exceptions remain independent and unchanged: the
[PR #3843 provider-capture cost](project16-final-review.md) and the
[PR #4297 preview-ownership comparison](project16-preview-performance.md).
Their failures, reviewer decisions, raw evidence and limitations remain in
those records. This additional acceptance neither reruns nor supersedes them.
