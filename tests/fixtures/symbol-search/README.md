# Paged symbol-name search

Implementation-ready #2572 on main base
`42962e3fb67c1236242e89046627a0723f295bc2`.

The first scheduled attempt at product `52803832f6a8dd29e287182a37eb4a59c7d16a56`
passed all 22 focused tests, but **failed the 50 ms acceptance criterion**: one cold
camel-miss cell took 53.434208 ms. All 160 chronological observations are retained in
[the first performance capture](qualification/attempt-01-performance.json), with
[phase logs](qualification/attempt-01-validation.txt). The fixed schedule completed
before rejecting; browser/static/structure stages did not run. Other cold cells
were at most 30.037083 ms, and warm cells at most 3.127042 ms. Existing-index control
median/p95 was 6.045757/6.220917 ms before versus 6.094410/6.507333 ms after
(+0.80%/+4.60%). This failed attempt is not a passing performance claim.

Product `b8b23fa61d3376be0144552ccf9166c601a29afc` removes ASCII preflight scratch
normalization strings by counting exact lengths and scanning character codes.
The non-ASCII normalization path is unchanged. A new semantic/budget test covers
ASCII separators/acronyms/digit runs, the 0x7f/0x80 boundary, Unicode expansions,
contextual sigma, astral letters, combining marks and uncased scripts. This changed
product passed the same fixed schedule and subsequent browsers/checks at qualification
head `b94ce128689c21a0cdcab4912705cf522650a944`. There was no unchanged retry,
deadline waiver or sample exclusion.

Eight new tests cover prefix/full/simple names, literal substring and documented
camel initials, Unicode/normalization boundaries, empty queries, stable IDs, paging,
total result caps, cancellation, owned returns, no method decoding and a separate
exact/minus-one cache budget. The scale fixture contains 50,000 authored type names
plus the global type. Timing is deliberately not asserted in ordinary unit tests;
the acceptance threshold of 50 ms is recorded for cold and warm queries in the
fixed scheduled qualification, including misses/late matches and every search mode.

Retained Roslyn/CoreCLR UnnamedSlots PE hash and native method-name/token observations
are reused for independent identity checks; the 50k stress fixture is authored metadata,
not a claim that Roslyn generated it. The focused Chromium/Firefox/WebKit round exercised this same scale fixture and matching/bounds/ownership contracts. Native
execution, Studio/full matrix and untested cross-platform behavior are separate.

The lazy cache performs a full logical-byte preflight before retained arrays are
allocated, with allocation-free ASCII length counting and bounded per-name Unicode scratch strings. It stores normalized names,
initials and two-byte simple-name positions; it shares the index's private owned
records and copies only selected output records. Counters exclude engine object/
array/string overhead, pre-existing index and output pages. No process-heap improvement is claimed. Source mode matching is deliberately
explicit: Unicode lowercase, no canonical normalization, literal prefix/substring,
and ordered initials-subsequence camel abbreviations.


The first serial qualification driver was `/tmp/sharpforge-a13-search-driver.mjs`.
Install and expected missing-search API proof succeeded. Changed-product validation
reused those immutable baseline inputs, ran eight new plus 15 existing
index/navigation tests, the same fixed comparison, shared focused browsers, check
and structure under one outer limiter (concurrency 1/maxruns 1/heap 1024 MiB). Baseline and
candidate resolve their own CIL sources; unchanged transitive trees/manifests must
have identical Git hashes before sharing. No unrelated suite or native rebuild.

`comparison.mjs.txt` captures 20 alternating AB/BA existing-index constructor pairs
(5 warmups, 3 builds/cell), then 10 forward/reverse rounds of six queries: late and
miss cases for prefix, substring and camel. Each query gets a fresh 50k-type index
whose construction is outside the query timer. The cold query includes all lazy
cache preflight/normalization; the warm query immediately follows on the same index.
There are no query warmups, one query per cell, and GC before each cell. All 160
chronological values are retained. Each query cell must be at most 50 ms; failures
are reported after the fixed schedule and stop the driver before unrelated stages.
No repeat or sample exclusion is authorized absent an evidence-driven code fix.

`browser.py <repository> <output>` reuses the prior CSP/import-map runner, with
structured cell data saved before reporting a failure. Its sibling module captures
three fixed rounds of the same six cold/warm query pairs (36 raw cells per engine),
plus cache/query/result bounds, cancellation, Unicode, owned state and retained
native PE identity checks. It records all first-round costs without warming queries,
uses the same 50 ms threshold and closes every browser/server. Only an actually
completed successful engine is counted as passing. These are shared-host observations,
not a universal hardware, heap, significance or host-noise causal claim.

## Qualified result

All 23 focused tests passed. Static/manifests passed (3599 syntax modules, 3595
static modules, 977 Node files/37 browser scripts/30 areas, zero errors or ownership
collisions). Structure completed with 272 inherited findings and none on changed
paths. The retained native reference is .NET SDK 10.0.201, Roslyn
5.3.0-2.26153.122 and CoreCLR 10.0.5; assembly/PDB/compiler hashes are in the browser
report. No new native build was needed.

[Final Node capture](qualification/performance.json) retains all 160 values at
Node 24.21.0 on macOS arm64/Apple M3 Pro. All 120 query cells passed 50 ms:

| Query | Cold median / p95 ms | Warm median / p95 ms |
|---|---:|---:|
| Prefix late | 18.432249 / 20.490000 | 2.609437 / 2.896958 |
| Prefix miss | 17.251959 / 17.750708 | 1.527895 / 1.600250 |
| Substring late | 18.232000 / 20.131250 | 2.186104 / 2.531292 |
| Substring miss | 17.464292 / 17.838583 | 1.961271 / 2.135000 |
| Camel late | 18.361021 / 19.025084 | 2.433875 / 2.607292 |
| Camel miss | 17.650187 / 18.065333 | 1.661647 / 1.752708 |

The existing 20-assembly/20120-definition index constructor control's before/after
median was 6.472361/6.463507 ms and p95 6.727806/6.624320 ms; neither regressed by
more than 5%. These are fixed shared-host observations, not a significance,
universal latency, causal host-noise or speedup claim. Both original and changed
schedules remain visible; the failed initial product is not counted as qualified.

[Browser evidence](qualification/browser.json) retains all 108 query cells plus
four contract groups per engine on macOS 26.6 arm64, Playwright 1.63.0/Python 3.14.7.
Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 passed every 50 ms cell;
maximum cold/warm times were respectively 22.5/1.7, 28/3 and 20/2 ms. Browser timer
precision is retained as reported by each engine. The fixed 50k fixture's cache
contains 2,900,020 logical bytes, excluding engine overhead and the pre-existing
index. Broader platforms, source-VM/direct-CIL execution backends, Studio/full matrix
and actual process-heap bounds are not claimed by this browser metadata API batch.

[Validation log](qualification/validation.txt) records the exact commands and checks.
No product source changed after qualification; subsequent edits only publish evidence.
