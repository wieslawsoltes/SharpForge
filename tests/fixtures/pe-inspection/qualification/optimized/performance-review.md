# Construction candidate: qualification and both PE cohorts

The three construction changes passed a fresh native comparison and the
unchanged 130-test focused gate. The one scheduled optimized benchmark retained
all 960 rows and passed every output guard. **A quantified performance exception
is still required:** the cold-summary median is 18.23703% above its paired
baseline, and all three ordinary p95 statistics exceed baseline by more than 5%.
The warm metadata summary p95 is 130.99414% higher, an absolute 2.499114
microseconds per batch-normalized call.

Passing guards and sample counts establishes neither a performance budget pass
nor a causal explanation for changed timing. Both complete cohorts are retained,
including unfavorable tails. No further optimization or run was performed after
this cohort; the serial heavy-work slot was released.

## Frozen source and preserved evidence

| Identity | First cohort | Optimized cohort |
| --- | --- | --- |
| Measured HEAD | `40561f093648ea6cc5f840c0a19b3d8fb512b34b` | `6c3e8a7ecfcf2df8148b1ed25ef4796d43139eba` |
| Product source | `26d4808350116a2ae95c5216393bd690032c6034` | `d72a9fe1684ba28064f83f4307721a1d00b13137` |
| Source and native-fixture pin | `26d4808350116a2ae95c5216393bd690032c6034` | `135c4c0b151acc92b28b724b410e9db54066b29e` |
| Exact baseline | `d64188af91f03d02041316bdde2ee64fd0634be0` | `d64188af91f03d02041316bdde2ee64fd0634be0` |

The [first report, receipt, log, original native capture, and full independent
review](../performance-first/independent-review.md) remain byte-exact. The new
[benchmark.json](benchmark.json), [benchmark.log](benchmark.log), and
[benchmark-execution.json](benchmark-execution.json) are also exact copies of the
original files from this run. [performance-review.json](performance-review.json)
contains their hashes, exact unrounded statistics, signed absolute changes for
both cohorts, source/tool identities, and raw tail rows. It is derived evidence;
the captured reports were not edited.

The optimized report SHA-256 is
`d171288f90b9918d62fdfab8b005df86a8b6c3d355bcff55d203c870c4763ee4`;
the log SHA-256 is
`e76faffaa8dffe32d22fa9ccd2d0b16c227c61fd73d5cf933b2aa9e6d718afa6`;
the execution receipt SHA-256 is
`e6dd8a54e9f9fe5fb5f13c9e2100015a3f7d90e23b65c70712bf07d3a3502c43`.
The report ran from `2026-10-04T15:31:10.484Z` through
`2026-10-04T15:31:26.154Z` on Node v24.19.0, Linux x64, the same shared-host
environment and pinned Node executable as the first cohort.

The executable driver differs from the original only in its product/fixture
revision and native capture hash constants. Its exact SHA-256 is
`c204eda904ff5768de61dbf319d357c00b997912fd4833f36ce07562f72aa4c1`.
The reviewed dynamic-import allowance still permits exactly two imports and is
pinned to that hash. The workload module, timing loop, statistics, source checks,
native comparison helper, and output guards are unchanged.

All 20 warmup and 100 measured batches for each workload/variant are retained:
160 warmup and 800 measured rows. Independent read-only recomputation confirmed
every call count, guard, sequence number, alternating variant order, rotating
workload order, median, nearest-rank p95, and nearest-rank p99. All result hashes
for both variants and both feature inputs equal the corresponding first-cohort
hashes. The same arithmetic fixture, exact baseline, and two pinned real images
were used; no workload, input, or guard was removed to qualify the changes.

## First cohort: complete ordinary comparisons

Times are **microseconds per call normalized from a complete batch**, rounded to
six decimal places in these tables. The percentiles are distributions of batch
means, not individual-call latency. The JSON review retains the original
unrounded nanosecond values and exact computed deltas for both cohorts.
Absolute change is candidate minus the baseline from the same cohort.

| Workload | Statistic | Baseline µs | Candidate µs | Absolute change µs | Change |
| --- | --- | ---: | ---: | ---: | ---: |
| `readPE` | Median | 17.625788 | 20.027740 | +2.401952 | +13.627490% |
| `readPE` | p95 | 36.880010 | 46.639610 | +9.759600 | +26.463116% |
| `readPE` | p99 | 52.899410 | 50.757860 | -2.141550 | -4.048344% |
| `coldSummary` | Median | 42.150065 | 51.392900 | +9.242835 | +21.928400% |
| `coldSummary` | p95 | 100.121070 | 121.540660 | +21.419590 | +21.393689% |
| `coldSummary` | p99 | 192.653890 | 180.414400 | -12.239490 | -6.353098% |
| `warmMetadataSummary` | Median | 1.019568 | 1.296065 | +0.276497 | +27.119035% |
| `warmMetadataSummary` | p95 | 1.754640 | 2.096302 | +0.341662 | +19.471914% |
| `warmMetadataSummary` | p99 | 1.941214 | 2.656706 | +0.715492 | +36.857966% |

## Optimized cohort: complete ordinary comparisons

| Workload | Statistic | Baseline µs | Candidate µs | Absolute change µs | Change |
| --- | --- | ---: | ---: | ---: | ---: |
| `readPE` | Median | 19.654120 | 18.917460 | -0.736660 | -3.748120% |
| `readPE` | p95 | 35.137655 | 38.420680 | +3.283025 | +9.343324% |
| `readPE` | p99 | 44.991240 | 44.457505 | -0.533735 | -1.186309% |
| `coldSummary` | Median | 40.831050 | 48.277420 | +7.446370 | +18.237028% |
| `coldSummary` | p95 | 93.545520 | 106.229280 | +12.683760 | +13.558918% |
| `coldSummary` | p99 | 114.155120 | 125.394350 | +11.239230 | +9.845577% |
| `warmMetadataSummary` | Median | 1.043594 | 1.075273 | +0.031679 | +3.035567% |
| `warmMetadataSummary` | p95 | 1.907806 | 4.406920 | +2.499114 | +130.994137% |
| `warmMetadataSummary` | p99 | 7.425296 | 9.344510 | +1.919214 | +25.846970% |

## New API costs and tail observations

These `inspectPE` operations have no equivalent baseline API. Their times use
the same microseconds per batch-normalized call as the ordinary comparisons.

| Input | Cohort | Median µs | p95 µs | p99 µs |
| --- | --- | ---: | ---: | ---: |
| ReadyToRun | First | 176.436160 | 376.357080 | 613.406960 |
| ReadyToRun | Optimized | 177.173180 | 373.683760 | 446.262040 |
| Mixed mode | First | 126.853100 | 280.221080 | 324.154560 |
| Mixed mode | Optimized | 116.879480 | 244.347600 | 298.445520 |

The optimized candidate is slower in 70/100 paired `readPE` rounds, 64/100
paired cold-summary rounds, and 67/100 paired warm-summary rounds. The first
cohort counts were 74, 78, and 92. These descriptive counts do not establish
statistical significance. The negative difference between the two marginal
`readPE` medians does not mean the candidate won most paired rounds.

| Ordinary workload | First baseline max µs | First candidate max µs | Optimized baseline max µs | Optimized candidate max µs |
| --- | ---: | ---: | ---: | ---: |
| `readPE` | 65.173605 | 53.372805 | 47.973625 | 54.319210 |
| `coldSummary` | 206.357340 | 1,291.435830 | 132.069310 | 174.566530 |
| `warmMetadataSummary` | 1.948544 | 7.719166 | 10.975656 | 9.435852 |

All original and optimized tail rows remain in the complete reports. The largest
optimized warm candidate batch, sequence 771/round 76, took 4.717926 ms for
500 calls and had a positive heap delta of 2,608,312 bytes. Another candidate
batch, sequence 190/round 3, took 4.672255 ms and had a negative heap delta of
51,994,432 bytes. The largest baseline warm batch, sequence 710/round 68,
took 5.487828 ms with a negative heap delta of 205,645,136 bytes. These
observations do not establish GC or scheduling as the cause of the high p95.
No rows were discarded or characterized as noise. Signed heap deltas remain
observations, not allocation counts or peak heap measurements.

The unchanged baseline's medians moved between cohorts by +11.50776% for
`readPE`, -3.12933% for cold summary, and +2.35649% for warm summary. The
candidate medians moved by -5.54371%, -6.06208%, and -17.03557% respectively.
The source changes preceded the second cohort, but those cross-cohort differences
do not isolate their causal contribution. In particular, the warm median is
closer to baseline while its p95 gap is much larger. Both facts belong in the
performance disposition.

## Native and focused correctness qualification

The fresh capture ran once at
`b29dd68de7d0d20eea64ef9b3ce29c80ebefabac`, with unchanged observer, manifest,
toolchain, images, and comparison helper. The new native capture SHA-256 is
`8cf9f13a29b3d74f4d6d395a521f130de5abf6d7482d16a8763109a3d0cd80f1`.
The [native command](native-command.json), [log](native-capture.log), and
[complete raw comparison](native-comparison.json) preserve all evidence.

The native facts and all eight parity groups match the original exactly. The
ReadyToRun image has 224 MethodDefs, 205 available CIL bodies, and no CIL body
read failures. The mixed-mode image has 90 MethodDefs, 77 available CIL bodies,
no CIL body read failures, and 11 Native methods left undisassembled. The
complete captures differ only in three source hashes and two observer timing
observations. The original native capture and its source hashes remain unchanged
in the first-cohort archive. Strict live-source freshness assertions in the
offline test and benchmark were preserved; no source-binding exception was added.

The exact original ten-file Node scope passed once at
`135c4c0b151acc92b28b724b410e9db54066b29e`: 130 tests, 130 pass, zero
failures/cancellations/skips/todos, 11,749.540637 ms. The test command exited 0.
The separate post-run receipt parser failed because it expected `#` summary
markers and received Node's default `ℹ` markers. The untouched
[receipt](focused-command.json), [complete output](focused-node.tap), and
[separate reconstruction note](focused-review.json) record that bookkeeping
failure. Counts were extracted read-only from the existing final reporter lines;
the test was not rerun, and no source or test assertion changed.

## Remaining performance decision and qualification limits

The three source edits remove discarded directory objects, the default empty
header spread, and immediately spread method-fact wrappers. They retain all
required UInt64 observations, public fields and field order, fresh disassembly
ownership, validating classification, cancellation, bounds, and public cache
identity. Passing focused tests and measured output identities supports those
contracts within the tested scope.

The remaining cost must receive an explicit quantified PR disposition. Required
additional headers and implementation facts are a reason to examine tradeoffs,
not proof that all observed cold-summary or warm-p95 cost is unavoidable. The
review does not authorize a blanket exception, replace either cohort, or claim
that the source edits measurably fixed the original regressions.

Both reports use one small three-method PE32 control, two real reference images,
one process holding both package graphs, and a shared Linux Node host. They do
not qualify browser performance, all large assemblies, native instruction
execution, Windows mixed-mode execution, ReadyToRun method maps, or signing
verification. Browser, build, and broader platform qualification remain pending.
No additional source change, capture, focused test, or benchmark was run after
the scheduled optimized cohort, and the reconciliation audit was not modified.
