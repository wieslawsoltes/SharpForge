# Guarded CIL scalar field loads

This T08.4 increment reuses normalized scalar values for `ldfld` and `ldsfld`.
It uses the same `scalarStorageGuard` predicates as scalar local/argument loads.
The existing field-resolution cache remains responsible for receiver checks,
closed generic signatures and metadata invalidation; this increment adds no cache.

Every read inspects the current value. Only canonical integers, immutable stored
Single/Double carriers, native integers matching the VM ABI, and immutable Decimal
values bypass `vm.storage`. Values changed through host heap/static access still
fall back to normalization when their representation or range is noncanonical.
Enums, references, aggregates, managed pointers, unresolved generic parameters and
unrecognized signatures always retain the storage adapter.

`scalarFieldLoads: false` disables the field-load shortcut for differential runs.
Field initialization, static/thread/generic slot selection, volatile ordering,
managed-address writes and write notifications are unchanged. No values or plans
are retained across reads or snapshots. Array and aggregate optimizations remain
outside this increment; the source interpreter is unchanged.

The timing target in #1398 remains **unmeasured**. No speedup or allocation count is
claimed. Focused regressions are prepared for the parent's serial validation queue;
tests, builds and benchmarks have not been run for this change.
