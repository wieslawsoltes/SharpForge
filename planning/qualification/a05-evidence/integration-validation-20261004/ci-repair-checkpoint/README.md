# CI repair and latency-harness checkpoint — 2026-10-04

This archive retains three root validation runs and two separate source-profiler
fixture runs. All eight original logs and journals were copied byte-for-byte.
[manifest.json](manifest.json) records their SHA-256 hashes, sizes, exact source
paths, revisions/trees where captured, and results. These overlapping selections
must not be added into a combined total or described as full A05/A00 qualification.

| Selection | Recorded source | Tests | Passed | Failed | Skipped | Test duration |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Initial budget, dispatch and cache cursor | `59da6ca7710e867702189cd67e3eedd527fb8c13` | 216 | 208 | 8 | 0 | 21,221.426102 ms |
| Runtime candidates after initial fixture repair | `0e111a882cae857c77cb3add3ce541023a413df6` | 308 | 306 | 2 | 0 | 37,273.350056 ms |
| Source-profiler fixture reproduction | Parent `d1e4d807a`, original fixture blob | 4 | 2 | 2 | 0 | 1,803.618209 ms |
| Source-profiler fixture repair | Same parent, uncommitted fixture patch later committed as `a75cafa0e` | 4 | 4 | 0 | 0 | 1,641.316149 ms |
| Byref/Wasm latency harness and adjacent runtime contracts | `65130534ef8cec81662b17d9eb0d1d76c6030cdc` | 53 | 53 | 0 | 0 | 13,125.154875 ms |

The initial failures comprise six inline-cache cursor fixtures and two
source/reloaded reservation-result fixtures. The subsequent 308-test selection
includes their repaired fixtures and retains two source-profiler fixture failures.
Those two failures also reproduce in the separate four-test run. The later
four-test pass does not rewrite the 308-test run into a pass.

The source-profiler repair admits generated startup and reaches `Main` through
ordinary execution before installing the deliberately minimal instruction
observer. Startup legitimately performs method-entry observation. The repaired
fixture then verifies exactly one observer lookup per slice, dynamic instruction
method replacement, sequence pause, exhausted budgets, fault accounting and real
instruction profiling. No production observer behavior or assertion was removed
to avoid startup admission.

The 53-test run covers the new complete managed-reference and compiled-Wasm
latency harnesses together with existing call tiering, OSR, heap/runtime bridge,
deoptimization and qualification options. These tests verify harness correctness
and rejection paths. They are **not** prescribed latency/allocation measurements,
speedup results, browser qualification, or a T12 repeatability baseline.

The root journals retain exact expanded argv, source tree, start/end timestamps,
exit status, final revision and clean status. The latter two also retain the
one-run/one-test/512-MiB resource limits. For the initial run, the coordinator
confirmed those same limits from its original orchestration command; they were
not fields in the original journal. Its contemporaneous Node version was not
captured and is not inferred.

The separate profiler logs have no machine-written journal. The executing agent
identified the parent revision, original fixture blob
`f21c03141d121f3f1f2234f157a09d946beb4de6` and repaired blob
`9d2c6688bf9dbde6801aed2511a0997bf625a5f1`. The passing patch was uncommitted
during execution and subsequently committed as
`a75cafa0e3fb6ee908545da50204cb997170fa74`. The supplied command and limits are
explicitly labeled reconstructed in [provenance-notes.json](provenance-notes.json),
not claimed as independently journaled. Runtime versions and clean-tree status
were not recorded for those focused runs. The raw logs themselves establish the
case names, path, outcomes and durations.

The separate [A00 contract archive](../a00-contracts/README.md) retains the 81/81
focused result, 2/2 compatibility result and incomplete full-A00 attempt. Those
counts are not repeated or added here. Historical failed CI and platform reports
remain unchanged, and this checkpoint changes no issue acceptance status.
