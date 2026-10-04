# Optional Int64 CIL specialization

`new CilVirtualMachine(assembly, {specializeNumericHandlers: true})` now also
selects Int64/UInt64 arithmetic, unary and comparison/branch handlers in the
existing decode plan. It uses the same option, bounded verifier category
analysis and invalidation rules as [Int32 specialization](int32-specialization.md).
The option remains off by default; no new wire IDs, carriers or ABI are introduced.

Each handler checks the actual operand slots before consuming them. Only BigInt
values within the signed 64-bit range take this path. Unsigned operations interpret
their bits using the existing Int64 helpers and still produce signed stack patterns.
Shifts accept proven Int32 or Int64 counts and use their low six bits. Native counts,
unknown categories and host-edited noncanonical values use the original handler.

Wrapping arithmetic and bitwise/shift operations preselect their operation during
decode. Checked arithmetic and division/remainder reuse `int64Binary`; comparison
and unary handlers reuse `int64Compare` and `int64Unary`. This removes the generic
numeric-category dispatcher for selected operations but retains shared helper
dispatch for fault-sensitive arithmetic. Both signed `MinValue / -1` and
`MinValue % -1` keep the existing `OverflowException` contract.

The same `vm.pop`/`vm.push` calls preserve stack admission and instruction boundaries.
There are no frame fields, pool changes or snapshot schema additions. Frozen
`numericHandlerIds` diagnostics add names such as `add_i8` and `shr_un_i8`;
Int32 IDs remain unchanged. Typed-float handlers can share the cached category
facts without sharing either option's dispatch switch.

All 93 focused tests passed at `f629a526`, covering deterministic full-width arithmetic differentials,
host-edited values, shifts, comparisons, calls, snapshots, pooled frames, instruction
quotas and coexistence with Int32/float handlers. Direct-CIL tests reuse the unchanged
22-row [.NET 10.0.5 boundary fixture](../tests/fixtures/a05/int64-arithmetic/native-boundaries.json)
with its existing provenance; no new native output was generated.

This is an adjacent T08 width increment, not completion of #1396's Int32
qualification or #1397's guarded small-long carrier. Source/reloaded-source
specialization, native-width and Decimal handlers, and changes to BigInt storage
remain outside this slice. Required PR checks run after this focused validation. Builds and benchmarks were
not run in the implementation slot. Allocation, throughput, latency and platform qualification
remain unmeasured; no speedup is claimed.
