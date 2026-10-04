# Integrated PE performance: complete observed cohort

This records the single integrated cohort and an independent retained-data review. The coordinator’s separately authored `ROOT-INTEGRATION-F009-PERFORMANCE-DISPOSITION.md` accepts the quantified costs as an automated correctness-cost exception. That exact record and its JSON review are retained without edits. This statistical report grants no approval and claims neither a 5% threshold pass nor human review.

Candidate `ddf3da105ace61ed61463a5704caf93c0c3dcf6f` was compared with baseline `f009e2949f3311f0ca84a4a6bc694535140d130b`. The candidate product is the unchanged merge `8f0f0feec8ed8955e6119a346051ec6fdd965760`; fresh native qualification remains `74559c16430dbf50778afe96d3c19a7cc3ade8e4`. The earlier cancellation-first cohort and disposition remain distinct and byte-exact.

The outer phase ran once from 2026-10-04 20:42:38.935207 through 20:43:05.286953 UTC. The harness ran from 20:42:39.696 through 20:43:05.145 UTC. Exit was zero, signal null, no interruptions or inspection errors, and source snapshots unchanged. Outer and all twelve child stderr files are empty. No retry, filtering, expectation edit or product change occurred.

The preflight recorded a team quiet pause, no competing candidate processes, twelve owned aliases across candidate/baseline, and 498,348,032 free disk bytes. The host remains shared rather than isolated: Node v24.19.0, Linux x64/kernel 6.18.44, AMD EPYC 9V74 80-Core Processor, nine visible logical CPUs, 2,048 MiB Node heap limit and no forced GC. This observation does not establish causation or statistical significance.

## Timing results

All values below are **microseconds per operation, computed from batch means**. They are not distributions of individual-call latency. Each side has twenty warmup batches followed by one hundred measured batches. Median is the mean of sorted positions 49/50; nearest-rank p95/p99 use positions 94/98 (zero-based).

| Workload | Metric | Baseline | Candidate | Delta | Change |
|---|---|---:|---:|---:|---:|
| small | median | 15.867406 | 21.291738 | +5.424332 | +34.185373% |
| small | p95 | 158.667008 | 106.872031 | -51.794977 | -32.643823% |
| small | p99 | 224.414805 | 178.692898 | -45.721906 | -20.373837% |
| small | min | 11.741930 | 12.594508 | +0.852578 | +7.260971% |
| small | max | 241.204781 | 224.093438 | -17.111344 | -7.094115% |
| dense96 | median | 61.733781 | 67.726344 | +5.992563 | +9.707104% |
| dense96 | p95 | 119.839438 | 134.387656 | +14.548219 | +12.139759% |
| dense96 | p99 | 167.299156 | 178.295906 | +10.996750 | +6.573105% |
| dense96 | min | 52.112469 | 53.204063 | +1.091594 | +2.094688% |
| dense96 | max | 216.094250 | 192.298063 | -23.796187 | -11.011948% |
| il | median | 56.582469 | 56.504070 | -0.078398 | -0.138556% |
| il | p95 | 199.252156 | 220.271281 | +21.019125 | +10.549008% |
| il | p99 | 330.266922 | 244.236953 | -86.029969 | -26.048618% |
| il | min | 50.328750 | 50.010469 | -0.318281 | -0.632404% |
| il | max | 334.192203 | 293.188359 | -41.003844 | -12.269539% |
| r2r | median | 133.979760 | 140.059280 | +6.079520 | +4.537641% |
| r2r | p95 | 521.370040 | 534.048280 | +12.678240 | +2.431716% |
| r2r | p99 | 631.880320 | 663.672240 | +31.791920 | +5.031320% |
| r2r | min | 118.155080 | 119.348880 | +1.193800 | +1.010367% |
| r2r | max | 753.341520 | 673.613640 | -79.727880 | -10.583232% |
| mixed | median | 103.104820 | 89.921260 | -13.183560 | -12.786560% |
| mixed | p95 | 514.508800 | 498.205240 | -16.303560 | -3.168762% |
| mixed | p99 | 658.593600 | 591.025160 | -67.568440 | -10.259504% |
| mixed | min | 93.672360 | 79.648560 | -14.023800 | -14.971118% |
| mixed | max | 1123.229160 | 626.948320 | -496.280840 | -44.183401% |

Across the five predefined statistics there are eleven adverse latency metrics. Seven exceed 5%, including the small minimum; six exceed 5% among median/p95/p99. No maximum regressed, and all five mixed-image metrics decreased. The complete adverse set is:

| Workload | Adverse metric | Added µs/op | Increase |
|---|---|---:|---:|
| small | median | 5.424332 | 34.185373% |
| small | min | 0.852578 | 7.260971% |
| dense96 | median | 5.992563 | 9.707104% |
| dense96 | p95 | 14.548219 | 12.139759% |
| dense96 | p99 | 10.996750 | 6.573105% |
| dense96 | min | 1.091594 | 2.094688% |
| il | p95 | 21.019125 | 10.549008% |
| r2r | median | 6.079520 | 4.537641% |
| r2r | p95 | 12.678240 | 2.431716% |
| r2r | p99 | 31.791920 | 5.031320% |
| r2r | min | 1.193800 | 1.010367% |

The two adverse medians above 5% are small (+5.424332 µs/op, +34.185373%) and dense96 (+5.992563 µs/op, +9.707104%). The other primary metrics above 5% are dense96 p95/p99, IL p95, and ReadyToRun p99. Favorable observations are retained alongside these costs, without claiming a speedup cause or dismissing adverse values as noise.

## Supplemental arithmetic means

Root also reviewed these arithmetic means from the same one hundred measured batch means. They are supplemental summaries, not an additional workload or cohort. The independent check below recomputed them from the retained raw samples; the original independent review JSON/source remain byte-exact.

| Workload | Baseline µs/op | Candidate µs/op | Delta µs/op | Change |
|---|---:|---:|---:|---:|
| small | 33.312174 | 34.356119 | +1.043946 | +3.133827% |
| dense96 | 73.500356 | 80.273298 | +6.772942 | +9.214842% |
| il | 81.530071 | 80.486512 | -1.043559 | -1.279968% |
| r2r | 185.125459 | 196.264263 | +11.138804 | +6.016895% |
| mixed | 157.182062 | 138.757870 | -18.424193 | -11.721562% |

Supplemental means regress for small (+3.133827%), dense96 (+9.214842%) and ReadyToRun (+6.016895%). The coordinator’s separate exception explicitly includes them and the signed heap observations.

## Signed heap observations

These are signed `heapUsed` changes across each measured batch in **bytes per batch**, not allocations, retained memory, peak RSS or evidence of a GC cause. Operations per batch are small 128, dense96 32, IL 64, ReadyToRun 25 and mixed 25. Negative values and their counts are retained.

| Workload/side | Median | p95 | p99 | Minimum | Maximum | Negative batches |
|---|---:|---:|---:|---:|---:|---:|
| small/baseline | 3,495,880 | 3,512,712 | 3,522,912 | -82,377,560 | 3,543,016 | 9 |
| small/candidate | 3,815,672 | 3,834,096 | 3,842,424 | -55,124,696 | 3,842,440 | 8 |
| dense96/baseline | 3,924,456 | 3,931,968 | 3,932,880 | -58,591,808 | 3,933,488 | 7 |
| dense96/candidate | 4,524,024 | 4,531,240 | 4,533,680 | -58,884,424 | 4,549,848 | 8 |
| il/baseline | 7,249,692 | 7,256,240 | 7,324,472 | -151,724,112 | 7,337,184 | 14 |
| il/candidate | 7,409,724 | 7,417,784 | 7,481,520 | -39,288,456 | 7,496,864 | 13 |
| r2r/baseline | 7,562,184 | 7,577,536 | 7,616,000 | -25,932,336 | 7,641,160 | 11 |
| r2r/candidate | 7,623,304 | 7,627,576 | 7,676,848 | -162,471,072 | 7,710,504 | 13 |
| mixed/baseline | 4,716,760 | 4,748,392 | 4,756,456 | -105,483,024 | 4,779,720 | 10 |
| mixed/candidate | 4,792,416 | 4,823,432 | 4,830,496 | -91,481,304 | 4,859,664 | 10 |

| Workload | Median change, bytes/batch | Mean measured change, bytes/batch | Sum of measured changes, candidate minus baseline |
|---|---:|---:|---:|
| small | +319,792 | +1,063,291.12 | +106,329,112 |
| dense96 | +599,568 | -37,962.48 | -3,796,248 |
| il | +160,032 | +1,632,407.52 | +163,240,752 |
| r2r | +61,120 | -2,130,687.36 | -213,068,736 |
| mixed | +75,656 | +386,840.40 | +38,684,040 |

The independent review JSON also retains every signed p95/p99/minimum/maximum comparison, measured mean and sum, warmup sum, total interval sum and zero/negative count. Interval sums do not measure retained live memory or total allocations.

## Guards, source review and retention

The twelve children ran serially in the prescribed order: prepare-baseline, prepare-candidate, small-baseline, small-candidate, dense96-candidate, dense96-baseline, il-baseline, il-candidate, r2r-candidate, r2r-baseline, mixed-baseline, mixed-candidate. Their recorded time spans do not overlap. Ten measurement children account for 1,200 chronological rows: 1,000 measured and 200 warmup. All 65,760 timed calls passed guards, comprising 54,800 measured and 10,960 warmup calls. Sixty additional untimed reader preflight calls guard five inputs in each child.

Independent standard-library arithmetic and read-only Git inspection matched all distributions and percentage changes, all job/result/log hashes, all five input hashes, 372 baseline and 373 candidate package source files, 1,133 outer snapshot source files, ten tool hashes, and all 532 fresh native source hashes. Native linkage remains 58 authored cases plus three supplied real images; the prior 91-test gate remains unchanged. The exact optional revisions, owned public imports and one reviewed worker import authority were checked.

The timed path remains public `readPE` plus storing returned references. Inputs, options, output arrays, source checks, imports, fixture construction, full reader-fact comparisons and statistics are outside timing. Reader guards include borrowed input identity, complete data facts, module name and section offset queries. Method-body callback invocation is not a timed workload or an additional benchmark qualification claim.

The integrated product difference adds checked header/range admission and two private interval arrays with sorting over at most 96 sections, in O(n log n) time and O(n) space. Public section order remains unchanged. RVA queries add range checks but do not create interval arrays or sort. Those operations occur on the measured read path; this cohort does not isolate their causal contribution. No optimization or follow-up cohort was attempted.

All 52 raw cohort files (4,265,710 bytes) are retained in `performance-integration-f009`, including every job, result, log, chronological report and generated workload image. Three outer files plus the original performance preflight are retained in `execution-integration-f009` (282,634 bytes). The raw retained total is 56 files and 4,548,344 bytes. Two byte-exact independent-review artifacts add 63,716 bytes. The two coordinator-authored disposition files, retention manifest and this report are additional derived files. SDK/runtime binaries and supplied external images are not copied. Original external evidence remains untouched.

| Evidence | SHA-256 |
|---|---|
| Cohort report | `cadcd76959b557d2cac79f8a63b3d130dbb26c9793448a53e1a783f973e4af7d` |
| Outer performance receipt | `246876416178848199a61224999db662cd6762e581b8b0cb3eec24dbd4af33d4` |
| Performance preflight | `8229888ace6c1f104ba10f8bf9ca56b34fd5caa52f7d2167467582d4073abfe5` |
| Independent review JSON | `100f231ce5da5859d0017c7e684c2202601f40dd5490249046f33ebe1f24ed18` |
| Root disposition | `52cef1e44fd58883b84322d0a5b08d9d8bd09add084eb0a9f979a922ca7533df` |
| Root JSON review | `c637b972f58a8093ce2c1896865a08344be3e62ea1845aa52c0c20ffac55b69c` |
| Independent review source | `05022668a2ef49b72f0e0e466644da4bd5e79e92c3e844cb258f7094aa4d45e6` |

The exact command and environment are preserved in the outer receipt. `integration-performance-retention.json` lists every origin, retained path, byte count and hash. The report status `completed` and successful guard receipts describe completed measurement; they are not performance acceptance. Browser, other native operating systems, input-assembly execution and cancellation-injection coverage remain unrun.
