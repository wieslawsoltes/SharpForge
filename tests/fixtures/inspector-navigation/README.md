# Inspector navigation and method pages

Implementation draft for #2575 at main base
`e905566c1933830deb6de7249062113c2b0eeee5`. No install, tests, checks, benchmark
or browser run has occurred for this branch; it waits behind the scheduled
PDB pair and loader batch.

Eight prepared tests cover a 20,000-method image with exact cache/decode counts,
owned page results, definition-only/empty/end pages, invalid limits, aggregate
declared-code budget before decoding, cancellation, default summary compatibility,
MethodPtr order, every declared metadata row/user-string URI, raw token coercion,
wrong module identity and the retained Roslyn UnnamedSlots PE.

No native rebuild is needed. URI spelling uses standard MVID GUID byte ordering;
the authored fixture pins a known GUID, while the native PE proves reload lookup
and matching method descriptors. This is inspection only: no assembly execution
or external assembly loading. Platform/browser checks and a fixed existing-summary
control will be scheduled; no measured throughput or memory improvement is claimed.

Prepared qualification (not executed): one candidate install, one exact CIL
baseline archive with its own workspace link, and shared transitive packages
only after Git tree/manifest hash equality. The old baseline must fail the
definition-only page count, then a single focused suite covers the eight new
tests plus managed inspection/CLI/decompiler, MethodPtr, managed-resource
summary and IL-document consumers.

`comparison.mjs.txt` defines one fixed 20-pair AB/BA schedule for both cold and
cached legacy summaries, retaining all 80 chronological samples, full revisions,
fixture hash and exact output equivalence. `browser.py <repository> <output>`
runs the sibling module serially in Chromium/Firefox/WebKit, with 20,000-method
pages, ownership/bounds/URI reload checks, and SHA-256 verification of the
retained native PE. It records engine failures before rethrowing and closes
every browser/server. The shared authored builder in `fixture.mjs` is also used
by Node tests. These harnesses are staged for the explicit serial slot only.
