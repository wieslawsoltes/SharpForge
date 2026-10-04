# Metadata generations: independent performance disposition

**Automated reviewer sign-off: accept the explicitly quantified performance
exception for this correctness and bounded-reading batch.** This is a sign-off
by the ChatGPT root reviewer under CONTRIBUTING section 4, not a claim of human
review or a passing five-percent regression threshold. It applies to measured
product `edafb8018be5b75916c8655e9ff1147b38035a24`, protocol
`ddbbbd1925ba1d458cb35c44f6491d3fb2be2a04`, and the single cohort at harness
`bc8d887deed3daab6e436cac56690c8be85f96e4`.

## Evidence checked independently

The root reviewer recomputed all twenty workload distributions directly from
the one hundred measured batches per workload: true median, nearest-rank p95
and p99, min and max, and the corresponding elapsed-time statistics. All 2,400
chronological records, 112,540 warm calls and 562,700 measured calls match.
Every returned-result guard passed. All fifteen subprocesses exited zero with
null signals and have nonoverlapping recorded execution intervals.

The review compares all 62 retained raw files, 9,941,493 bytes, with their original
external capture bytes; checks every job/result/stdout/stderr hash and embedded
result; and verifies all public-package source inventories, source Git trees,
package manifests, 22 tool files, native reference and input-facts hashes.
Recorded product trees match both their measured commits and current source
bytes. The report SHA-256 is
`5f515a1c11a767535a52e1bb652fe71adddf0853a1255f1ab40a4fc19dad9b19`.

The independent receipt is `root-performance-review.json`, SHA-256
`13cdd93b0f3f82ff74a05c49c0453b8ce27eb186b1ede495ee2010aa98de220e`.
Its companion script is retained for reproduction. During development the
read-only review script corrected its assumptions about relative paths,
lexicographic filename ordering, nullable feature budget labels and bounded
workload suffixes. No product, sample, benchmark or native capture was changed
or rerun as part of that review.

## Costs accepted

Values are microseconds per operation. Percentiles describe distributions of
batch means, not individual-call latency. The complete favorable and adverse
results remain in `ORDINAL-PERFORMANCE.md` and the unmodified raw report.

| Existing default control | Metric | Before | After | Added time | Increase |
| --- | --- | ---: | ---: | ---: | ---: |
| Small PE | Median | 39.305574 | 45.784664 | 6.479090 | 16.4839% |
| Small PE | p95 | 78.440594 | 120.239711 | 41.799117 | 53.2876% |
| Small PE | p99 | 106.239695 | 140.469258 | 34.229563 | 32.2192% |
| Small metadata | p95 | 120.962828 | 156.303844 | 35.341016 | 29.2164% |
| Small metadata | p99 | 204.748391 | 235.212227 | 30.463836 | 14.8787% |

These are all greater-than-five-percent default-control increases among the
reported median/p95/p99 metrics. Real PE p99 also increases 1.8131%, or
5.230656 microseconds, and is retained rather than filtered out.

The explicit-row-bound option is a separate candidate-only comparison against
the candidate default; it is not a baseline-equivalent old API. Its complete
greater-than-five-percent increases are accepted as new-option costs:

| Explicit-bound control | Metric | Default | Bounded | Added time | Increase |
| --- | --- | ---: | ---: | ---: | ---: |
| Small metadata | Median | 31.286301 | 39.490805 | 8.204504 | 26.2240% |
| Real metadata | Median | 45.678648 | 56.292969 | 10.614320 | 23.2369% |
| Real metadata | p99 | 260.503047 | 317.910219 | 57.407172 | 22.0370% |
| Real PE | p95 | 145.271469 | 166.821078 | 21.549609 | 14.8340% |

## Reason for accepting this batch

Metadata generations require an owned baseline and transactional delta
admission, with limits enforced before row-array allocation and cancellation
checks during physical parsing. Reusing the existing physical metadata decoder
keeps row formats, pointer-table handling, heaps and malformed-input behavior
consistent across ordinary and generation reads. A separate decoder would
duplicate that authority and create another implementation to keep correct.

The default path still allocates no `MetadataReadBudget`, retains the existing
one-million-row limit and borrowed heap behavior, and performs exactly one
metadata parse through the PE reader. Source review identifies optional checks
per stream/table, a budget-presence branch in the row loop, and a final optional
check. Explicit bounds also check before row allocation. The reader extraction
and these shared checks are accepted with the measured costs above so this
bounded, transactionally validated API can land without replacing the decoder
or removing its checks. The corrected Module-generation ordinal check rejects
an out-of-order delta before aggregate mapping and leaves previous generations
unchanged; the unchanged failing assertion now passes in the 51/51 gate.

This cohort does not identify the causal contribution of each source change.
The decision accepts the recorded increases without attributing them to a
particular branch, discounting them as noise, or using other workloads'
improvements to erase them. No selective rerun, changed sample count, relaxed
guard, or after-the-fact workload substitution is part of the disposition.

## Scope and remaining qualification

Timing ran once on a shared Linux x64 host with Node 24.19.0/V8
13.6.233.17-node.51, AMD EPYC 9V74 and nine visible logical CPUs. Team serial
execution does not establish exclusive machine use. Signed `heapUsed` deltas
remain available; they are not allocation counts, peak RSS or a complete view
of ArrayBuffer/native allocation. Startup/import/native/setup/guards/disposal
are outside the per-call timers, so no startup or native-execution performance
claim follows.

This disposition does not establish browser, other operating-system, source VM,
direct CIL, Rust/Wasm, ApplyUpdate or edited-method execution qualification.
Build/core checks remain a separate merge gate. Tracking issue #693 remains
open for its wider acceptance criteria.
