# Paged symbol-name search

Implementation-ready #2572 on main base
`42962e3fb67c1236242e89046627a0723f295bc2`. No install, tests, benchmark, native or
browser run/check has occurred for this branch. Root schedules the sole serial slot.

Seven prepared tests cover prefix/full/simple names, literal substring and documented
camel initials, Unicode/normalization boundaries, empty queries, stable IDs, paging,
total result caps, cancellation, owned returns, no method decoding and a separate
exact/minus-one cache budget. The scale fixture contains 50,000 authored type names
plus the global type. Timing is deliberately not asserted in ordinary unit tests;
the acceptance threshold of 50 ms will be recorded for cold and warm queries in the
fixed scheduled qualification, including misses/late matches and every search mode.

Retained Roslyn/CoreCLR UnnamedSlots PE hash and native method-name/token observations
are reused for independent identity checks; the 50k stress fixture is authored metadata,
not a claim that Roslyn generated it. A focused Chromium/Firefox/WebKit round will
exercise this same scale fixture and matching/bounds/ownership contracts. Native
execution, Studio/full matrix and untested cross-platform behavior are separate.

The lazy cache performs a full logical-byte preflight before retained arrays are
allocated, with only bounded per-name scratch strings. It stores normalized names,
initials and two-byte simple-name positions; it shares the index's private owned
records and copies only selected output records. Counters exclude engine object/
array/string overhead, pre-existing index and output pages. No process-heap or
performance claim is made before evidence exists. Source mode matching is deliberately
explicit: Unicode lowercase, no canonical normalization, literal prefix/substring,
and ordered initials-subsequence camel abbreviations.


Prepared serial qualification, not run: `/tmp/sharpforge-a13-search-driver.mjs`
will await install, expected missing-search API proof, the seven new plus 15 existing
index/navigation tests, one fixed comparison, shared focused browsers, check and
structure under one outer limiter (concurrency 1/maxruns 1/heap 1024 MiB). Baseline and
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
