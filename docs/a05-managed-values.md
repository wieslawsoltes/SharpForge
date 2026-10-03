# Managed pointers and value copies

This runtime slice follows ECMA-335 sixth edition, Partition I managed pointer
lifetime rules and Partition III `ldflda`, `ldobj`, `stobj`, `cpobj`, `box`, and
`unbox`. A pointer to an interior field retains its managed heap owner. Stack
locations expire when their owning frame leaves the active or parked contexts.
`unbox` addresses the existing boxed storage; `unbox.any` returns a value copy.

Specification: [ECMA-335, June 2012](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
API reference: [OpCodes.Ldflda](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.opcodes.ldflda).

| Capability | Runtime adapter | Qualification boundary |
| --- | --- | --- |
| Stack, argument, static, array, box and nested struct field addresses | `address` / `dereference` | VM ownership and live frame IDs checked on access; readonly writes rejected |
| Struct assignment, argument, return and field copies | `storageValue` / `copyValue` | Immutable typed values recursively copy nested structs; object fields share managed references |
| Primitive, enum and struct boxing | `boxValue` / `unboxValue` | Boxes retain exact MethodTable identity; `unbox` aliases storage |
| GC through value fields and interior pointers | `forEachValueReference` | Active and parked context values, heap records, temporary roots and strong handles share the tracing adapter |
| Source IR values | `sourceValue`, `sourceStorageValue`, `sourceFieldValue`, `sourceFieldStore` | Static input types must be supplied when boxing erased primitive representations |
| Snapshot replay | Frozen values and location descriptors | Mutable struct updates replace values; snapshots retain previous values without alias leaks |

Source-language struct and ref syntax remains a compiler boundary. Runtime helper
and source IR tests do not claim that syntax is accepted. Ref structs, byref fields,
unsafe pointer arithmetic and physical struct memory layout are outside this
slice. Managed pointers cannot be stored in heap records, aggregate fields, boxes
or statics. The direct CIL verifier still needs its adapter to permit user struct
`cpobj`/`unbox`; `sizeof` remains restricted to its separate supported layout set.

The runnable native comparison example is
`tests/fixtures/a05/managed-values/Program.cs`. Its project targets .NET 10 and has
an adjacent expected output file. Independently assembled CIL fixtures also cover
malformed escaped stack references that C# deliberately rejects.

Run `node --test tests/a05-03-managed-values.test.js` and
`node tests/a05-03-benchmark.js` only after E01 is fully assembled. The benchmark
reports cold and warm helper latency, p95/p99, managed allocations and observed
host heap growth; host heap growth is affected by JavaScript GC and is not an
exact allocation count. Native comparison, browser worker execution, tool
versions and integrated commit IDs belong in the epic's validation evidence.
No validation evidence is claimed by these fixture definitions.
