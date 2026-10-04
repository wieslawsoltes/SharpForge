# Guarded CIL scalar slot loads

T08.4 reuses normalized immutable scalar values when executing `ldloc` and `ldarg`.
Call entry, initialized locals and every managed-address write already apply the
declared storage type. `stloc`/`starg` now rely on that single write boundary instead
of converting once in their handler and again in the managed-address adapter.

The metadata-only WeakMap plan classifies each slot by its live declared type. A
changed or instantiated signature is reclassified before a value is reused.
Runtime guards require canonical signed Int32/Int64 payloads, bounded small
integers, stored Single/Double tags, matching native ABI width, or a frozen exact
Decimal value. Noncanonical values pass through the existing storage adapter.
Enums, references, managed pointers, modified signatures, unresolved generic
parameters and aggregates retain the generic path. Decimal uses the existing
shared carrier; its VM admission/storage behavior still belongs to T01.7.

`scalarSlotLoads: false` restores normalization on loads for differential testing.
Plans contain no execution values and do not enter snapshots. Successful restore,
frame pooling and code-owner replacement need no plan migration: each load checks
its actual method and current storage type. Field and array load optimization,
typed evaluation stacks and compiler changes are outside this increment.

The instruction-normalized >=30% timing target in #1398 is **unmeasured**. No
speedup or allocation count is claimed. Focused tests are staged for the parent's
serial validation queue; browser, native-platform and broader engine evidence
remain pending. The source interpreter is unchanged.
