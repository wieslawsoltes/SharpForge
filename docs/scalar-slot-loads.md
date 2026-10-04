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

The instruction-normalized >=30% timing target in #1398 is **met** for the
same-host Linux x64 CIL qualification at `48c62243`: 100 measured pairs produced
a 71.686% reduction, with a 95% paired interval of 70.380–72.616%. The exact
[reports and wrapper provenance](https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/slots-virtual-48c62243/README.md)
retain all observations and environment limits. Browser, native-platform and
broader engine evidence remain pending. The source interpreter is unchanged.

## Canonical direct stores

The ordinary CIL `stloc` and `starg` handlers also reuse the scalar predicate when
`scalarSlotLoads` is enabled. An already canonical immutable scalar can be placed
directly in a live, writable own slot without constructing a temporary managed
address or repeating generic type substitution. The write revision still advances
once. The reference mode (`scalarSlotLoads: false`) retains the complete address
and storage path for differential testing.

The direct path checks the actual declared type, input carrier, frame identity,
slot descriptor and canonical VM adapters for every store. Narrowing, floating
rounding, observers, accessor properties, inherited holes, custom stack pops,
frozen storage, pointer/pinned/aggregate slots and host adapter overrides retain
the generic path. Snapshot restoration and pooled frames carry no store cache.
The same change applies to both virtual-cache qualification modes. The unchanged
paired scalar comparison includes both guarded loads and stores; it does not
isolate the contribution of either operation.

## Current integrated validation

Revision `7a088bfed` passed all 73 tests from the following serial command under
Node 24.19.0 on Linux x64 with a 512 MB heap limit:

```sh
NODE_OPTIONS=--max-old-space-size=512 node --test --test-concurrency=1 \
  tests/a05-callback-frame-index.test.js tests/a05-scalar-slot-stores.test.js \
  tests/a05-scalar-slot-loads.test.js tests/a05-prepared-virtual-calls.test.js
```

There were no failed, skipped or canceled tests. The callback suite verifies source
and CIL retained-frame addresses with both root modes, nested collection, the old
reference's collection after replacement, and stale frame rejection. These are
correctness results; performance acceptance comes from the separate wrapper run
linked above. The unchanged virtual fixture measured 2.153884× at `48c62243`,
with a 95% paired interval of 1.835978–2.521246×, so its 3× target remains missed.
The earlier 1.7945× result at `e5802c2e` remains historical evidence.
