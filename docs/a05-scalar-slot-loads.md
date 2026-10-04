# Scalar slot reads — SF-A05-T08.4

Direct CIL arguments and locals are normalized at call entry, initialization and every write, including writes through managed pointers. Reads of built-in immutable scalar types now reuse that value. Method metadata supplies a cached classification; closed generic instantiations receive independent plans. Structs, references, enums, pinned pointers and other unclassified types retain the existing storage adapter. Local and argument stores also stop normalizing twice: the managed-pointer write remains the single authoritative normalization and notification boundary.

`scalarSlotLoads: false` retains generic load normalization for differential and performance comparisons. The cache stores only method metadata and booleans and is not snapshot state. Replacing a method's local or parameter metadata invalidates its plan. Uninitialized-slot faults and managed write notifications remain unchanged.

PR #2804's method/field caches target different work and are not duplicated. Typed
evaluation storage, arithmetic specialization and small-long lanes compose with
these storage adapters through the T07 decode contribution.

Tests and measurements are prepared but intentionally not executed before E02 assembly. The T08.4 throughput target remains unqualified; no speedup or platform pass is claimed.
## Field loads

`loadField` applies the same immutable-scalar classification to resolved instance
and static fields. Its metadata-only cache keys the resolved signature, including
closed generic substitutions, and invalidates if that signature's type changes.
`scalarFieldLoads:false` retains the original read adapter for measurement.
Instance/static writes normalize once through their managed-pointer store; field
initialization, write observers, static initialization and volatile completion stay
at the existing boundaries. Reference, enum, managed-pointer and aggregate fields
retain the generic adapter. Prepared tests cover float identity and boundaries,
small-field truncation and notification, volatile completion and cache invalidation.
No field tests or measurements have run before E02 assembly.
