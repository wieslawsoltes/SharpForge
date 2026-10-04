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
