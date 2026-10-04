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
