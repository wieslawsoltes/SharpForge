# Metadata generation reader: first corrected-source performance cohort

The single predefined cohort completed all fifteen serial child processes and
2,400 chronological batches, with all correctness guards passing. **The small
ordinary PE control regressed: median +16.4839%, p95 +53.2876%, p99 +32.2192%.**
The small metadata control also has higher p95 and p99 despite a lower median.
These results require independent review; successful execution does not approve
an exception to the repository's performance budget.

No second cohort, adaptive sampling, product correction or benchmark adjustment
was performed after these measurements. All results, including improvements,
regressions, warmups and signed heap observations, are retained without filtering.

## Identity and execution

| Identity | Exact revision |
| --- | --- |
| Baseline | `31900dce5c1454c1f9c244c9ac14e1798eac3e5f` |
| Measured product | `edafb8018be5b75916c8655e9ff1147b38035a24` |
| Frozen protocol preparation | `ddbbbd1925ba1d458cb35c44f6491d3fb2be2a04` |
| Actual clean candidate and executable harness | `bc8d887deed3daab6e436cac56690c8be85f96e4` |

The outer wrapper ran on 2026-10-04 from **18:06:40.649929 through
18:07:26.916601 UTC**, exit zero and null signal. Its exact command was:

```sh
node scripts/limited.js node packages/cil/tools/benchmark-metadata-generations.mjs \
  --baseline /workspace/scratch/7e3d2a445c44/sf6-metadata-generations-baseline-31900dce \
  --output /workspace/scratch/7e3d2a445c44/project6-metadata-generations-performance.ordinal-first
```

It was invoked by `python tests/fixtures/metadata-generations/qualification/ordinal-run-step.py performance`.
The recorder had `CI` unset, one run slot, test concurrency one and a 2,048 MiB
heap setting. The measured Node children inherited
`NODE_OPTIONS=--max-old-space-size=2048`. Node was **24.19.0**, V8
**13.6.233.17-node.51**, Linux x64, kernel **6.18.44**, AMD EPYC 9V74,
nine visible logical CPUs. This was a shared host. The team reserved its sole
heavy slot for the cohort; that reservation does not establish host isolation.
Load averages changed from `[5.09, 4.57, 4.37]` to `[5.72, 4.8, 4.46]` and
reported free memory from 3,290,480,640 to 3,064,164,352 bytes. These observations
do not discount any measured regression.

The fresh baseline was created with `--detach --no-checkout`, the frozen minimal
sparse patterns and `read-tree -mu HEAD` only in that new worktree. Its five
public package aliases resolve into its own package directories. Candidate
aliases also resolve into its own checkout. `ordinal-baseline-preparation.json`
and `.py.txt` preserve exact commands, patterns, aliases and clean status. No
installation or full checkout was used. Disk free changed by 11,821,056 bytes
during preparation.

## Existing ordinary-reader comparisons

All values below are **microseconds per operation**. Each workload has twenty
warm batches followed by one hundred measured batches. Median is the true
even-sample median; p95 and p99 use nearest rank. Percentiles describe the
distribution of **batch means**, not individual-call latencies.

| Ordinary public operation | Operations/batch | Median before → after | Median change | p95 before → after | p95 change | p99 before → after | p99 change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `readMetadata`, small | 128 | 44.927082 → 31.286301 | −30.3620% | 120.962828 → 156.303844 | +29.2164% | 204.748391 → 235.212227 | +14.8787% |
| `readMetadata`, real | 64 | 57.516344 → 45.678648 | −20.5814% | 191.211594 → 180.758109 | −5.4670% | 302.299578 → 260.503047 | −13.8262% |
| `readPE`, small | 128 | 39.305574 → 45.784664 | **+16.4839%** | 78.440594 → 120.239711 | **+53.2876%** | 106.239695 → 140.469258 | **+32.2192%** |
| `readPE`, real | 64 | 78.552391 → 69.997727 | −10.8904% | 205.133047 → 145.271469 | −29.1818% | 288.486953 → 293.717609 | +1.8131% |

The small PE median adds **6.479090 µs/op**, p95 **41.799117 µs/op** and p99
**34.229563 µs/op**. The small metadata p95 adds **35.341016 µs/op** and p99
**30.463836 µs/op**. These are every greater-than-five-percent regression among
the reported existing-control median/p95/p99 metrics. The other median decreases
do not erase those costs or demonstrate which source change caused them.

The unchanged structural fixture produces 832 metadata bytes and 1,536 PE bytes.
The retained native CFG image has 6,204 metadata bytes and 11,776 PE bytes. Before
timing, baseline and candidate fully compare returned fields/key order, rows,
heaps, referenced values, ownership/aliasing, list/type callbacks, PE body
outcomes, RVA conversions and five actual native CIL bodies. Every returned
timed value is checked outside its timer. Unsupported filter/fault body outcomes
are explicit common facts, not reported as successful managed execution.

## Explicit lower row-bound costs

These compare the candidate's default reader with the candidate using an
explicit exact-row-count bound. A one-less bound must reject before measurement.
They measure a new option and are separate from baseline-equivalent controls.
No signal is supplied in these timing workloads; cancellation behavior belongs
to the focused gate.

| Candidate operation | Median default → bounded | Change | p95 default → bounded | Change | p99 default → bounded | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `readMetadata`, small | 31.286301 → 39.490805 | +26.2240% | 156.303844 → 136.426055 | −12.7174% | 235.212227 → 224.517922 | −4.5467% |
| `readMetadata`, real | 45.678648 → 56.292969 | +23.2369% | 180.758109 → 187.368078 | +3.6568% | 260.503047 → 317.910219 | +22.0370% |
| `readPE`, small | 45.784664 → 36.503320 | −20.2717% | 120.239711 → 82.903445 | −31.0515% | 140.469258 → 95.621961 | −31.9268% |
| `readPE`, real | 69.997727 → 53.966406 | −22.9026% | 145.271469 → 166.821078 | +14.8340% | 293.717609 → 226.369547 | −22.9295% |

The greater-than-five-percent increases here are small metadata median
**8.204504 µs**, real metadata median **10.614320 µs** and p99 **57.407172 µs**,
and real PE p95 **21.549609 µs**. Lower measurements on some bounded workloads
are retained as observations and do not imply that adding a bound removes work.

## New generation operations

These use the newly captured real Roslyn mixed baseline plus two metadata
deltas. They have no baseline-equivalent API and no native execution timing.
Construction owns the baseline PE; append prerequisites are prepared outside
timing. Full native replay, result validation, history inspection and disposal
are outside the timers. Entity and heap maps use four-probe fixed equal mixes.
Latest/historical rows query `Added` at generations two/one; heap entries cycle
through Strings, Blob, GUID and US, including `second update 😀`.

| Operation | Operations/batch | Median µs | Batch-mean p95 µs | Batch-mean p99 µs |
| --- | ---: | ---: | ---: | ---: |
| Construct | 25 | 85.453100 | 162.211400 | 224.034600 |
| Append first delta | 25 | 33.813440 | 68.605920 | 259.329200 |
| Append second delta | 25 | 40.504080 | 58.691800 | 64.816760 |
| Entity introduction map | 1000 | 0.080919 | 0.151643 | 0.311037 |
| Heap introduction map | 1000 | 0.101604 | 0.214545 | 0.255835 |
| Latest physical row | 1000 | 0.158217 | 0.203719 | 0.228826 |
| Historical physical row | 1000 | 0.164712 | 0.188377 | 0.221836 |
| Heap entry | 400 | 0.750114 | 1.164910 | 6.340610 |

The twenty workloads contain **400 warm and 2,000 measured batches**, totaling
112,540 warm and 562,700 measured public calls. The two preparation children are
untimed; the other thirteen children contain the twenty workloads.

## Memory and source review boundaries

Raw signed `heapUsed` deltas are retained for every batch. They are a net heap
proxy, not allocated-byte counts, peak RSS or retained product size; GC can make
them negative and many ArrayBuffer/native allocations are excluded. No forced
GC was used. For existing default controls, median net bytes per batch were:

| Workload | Baseline | Candidate |
| --- | ---: | ---: |
| Small metadata, 128 calls | 7,348,956 | 7,349,264 |
| Real metadata, 64 calls | 6,309,720 | 6,309,324 |
| Small PE, 128 calls | 8,366,824 | 8,365,772 |
| Real PE, 64 calls | 6,959,792 | 6,959,628 |

`ordinal-performance-retention.json` independently summarizes every workload's
net-heap median, p95, p99, min, max and number of negative measured batches.
The complete signed observations remain in each result and aggregate chronology.

Source review confirms ordinary reads allocate no `MetadataReadBudget` when
options are undefined, keep the previous million-row bound and borrowed heaps,
and parse metadata once through the PE reader. The table loop has an added
budget-presence check on each row; explicit bounds also check before row-array
allocation and cancellation at bounded intervals. Stream parsing was extracted
without adding a second parse. This review identifies the default-path work but
does not isolate its timing contribution. No product optimization or performance
exception is inferred from the single cohort; the measured small PE regression
and metadata tail increases remain for explicit independent disposition.

## Exact retained evidence

`performance-ordinal-first/` contains all **62 original files**, 9,941,493 bytes,
including the complete report, fifteen jobs/results/raw stdout/stderr pairs and
input facts. Its `report.json` SHA-256 is
`5f515a1c11a767535a52e1bb652fe71adddf0853a1255f1ab40a4fc19dad9b19`.
`execution-ordinal-first/performance.*` preserves the outer recorder's exact
JSON/stdout/stderr. `ordinal-performance-retention.json` hashes every retained
file and records an independent Python recomputation of all statistics and
comparisons directly from the one hundred measured samples per workload. Its
`.py.txt` preserves that verification and exclusive copy operation.

The report retains every tool SHA-256, public package source inventory/hash,
Git source tree, own alias, fixture hash, process outcome and actual environment.
CIL source inventory SHA-256 is
`65c807fca699cb8963eb6743cbff7782be973955da4d3dc13aed12d8fee063f6`
for the baseline and
`5e545a9bc074b9ef03587c92853ed42fc37efdbc5f6a4bac120c06c6b0d49e9f`
for the candidate. The unchanged four dependency package hashes are also
retained. Product/tool/source hashes are checked before and after the cohort.

The strict native reference SHA-256 is
`d8500a48fe75ae1583d3d8670b1bbf13c38c7befca3a47cbe971cee36ba7b9b9`,
Git blob `ddee1512f6982697a6590875e3c1fff8d0561205`, captured at `ddbbbd1925`.
Native provenance remains four raw workload commands; toolchain version probes
have identity records without raw probe output. Original native evidence, the
first failed 50/51 gate and the original Portable PDB corpus remain unchanged.
Browser, other native hosts, edited-method execution, ApplyUpdate, reconstructed
list ownership and source VM/direct CIL/Rust/Wasm targets remain outside this
qualification. These measurements do not substitute for build/core checks.
