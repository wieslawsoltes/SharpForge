# Scalar slot reads — SF-A05-T08.4

Direct CIL arguments and locals are normalized at call entry, initialization and every write, including writes through managed pointers. Reads of built-in immutable scalar types now reuse that value. Method metadata supplies a cached classification; closed generic instantiations receive independent plans. Structs, references, enums, pinned pointers and other unclassified types retain the existing storage adapter. Local and argument stores also stop normalizing twice: the managed-pointer write remains the single authoritative normalization and notification boundary.

`scalarSlotLoads: false` retains generic load normalization for differential and performance comparisons. The cache stores only method metadata and booleans and is not snapshot state. Replacing a method's local or parameter metadata invalidates its plan. Uninitialized-slot faults and managed write notifications remain unchanged.

PR #2804's method/field caches target different work and are not duplicated. This slice does not introduce a typed evaluation stack, specialized arithmetic, a small-long representation, or field-load normalization elision.

Tests and measurements are prepared but intentionally not executed before E02 assembly. The T08.4 throughput target remains unqualified; no speedup or platform pass is claimed.
