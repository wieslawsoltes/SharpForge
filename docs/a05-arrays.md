# A05 T05 array execution

The runtime stores rank, lengths, lower bounds, and row-major strides in a frozen
`arrayShape` on the managed heap record. The last dimension changes fastest.
Element values use the T03 copy, boxing, interior-pointer, and GC rules. The array's
actual element MethodTable controls every store through a covariant view.

Contracts are pinned to ECMA-335 sixth edition, II.14.2 and I.8.9.1, and the
[.NET 10 Array implementation](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/System.Private.CoreLib/src/System/Array.CoreCLR.cs),
[allocation rules](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/vm/gchelpers.cpp),
and [CreateInstance contracts](https://learn.microsoft.com/en-us/dotnet/api/system.array.createinstance?view=net-10.0).
Normal incompatible reference stores throw `ArrayTypeMismatchException`.
Reflection `SetValue` throws `InvalidCastException` for incompatible objects and
`ArgumentException` for disallowed primitive narrowing. A null reflected value
resets a value element to its zero-initialized value. Empty dimensions have an
upper bound one below their lower bound, with Int32 wrap at the minimum bound.

| Surface | Capability |
| --- | --- |
| CIL ARRAY pseudo-methods | `.ctor`, `Get`, `Set`, `Address`, ranks 1–32; lower-bound constructor arguments alternate bound/length |
| Vectors | `newarr`, typed loads/stores, `ldelema`, and `readonly. ldelema`; zero-based rank-one constructors become vectors |
| Array reflection | `CreateInstance(Type,int...)`, `CreateInstance(Type,int[]/long[])`, `CreateInstance(Type,int[],int[])`; `Rank`, `Length`, `LongLength`, `GetLength`, `GetLongLength`, `GetLowerBound`, `GetUpperBound` |
| Reflection element access | `GetValue`/`SetValue` with 1–3 Int32/Int64 indices or a managed Int32/Int64 index vector; boxing and permitted primitive widening |
| Source execution | Shared source IR create/get/set/address adapters; source-language rectangular-array and lower-bound syntax remains a frontend dependency |
| GC and snapshots | Interior pointers retain the array and nested references; frozen shape and value records replay with existing heap snapshots |
| Boundaries | Default one-million-element allocation cap and managed heap budget; `maxArrayLength` may configure a lower or higher cap; Int64 reflection indices must fit Int32 |
| Excluded surface | Pointer/byref/open-generic/void element types, native memory layouts, arbitrary reflection, bulk Array algorithms, and arrays exceeding the configured runtime budget |

`execution/arrays.js` exposes `createArray`, `arrayGet`, `arraySet`, `arrayAddress`,
`arrayDimension`, and source aliases. `array-calls.js` exposes
`arrayCall(vm,descriptor,args,instruction)` returning `{handled,returns,value}`.
Instance arguments include the receiver. The independent descriptor recognizer
`arrayMethodDefinition` is shared by the CIL verifier and runtime call adapter.

Integration owns the CIL index export and profile hook, calls/newobj dispatch,
source `NEWARR` adapter, and any final snapshot schema additions. `readonly.` sets
`frame.readonlyAccess`; `ldelema` consumes it. No new VM-level mutable fields are
introduced. The browser worker requires named imports and exports, which these
modules use.

The runnable native example is `tests/fixtures/a05/arrays/Program.cs`. Its committed
expected output covers rank, zero and nonzero lower bounds, covariant writes,
struct array copies, nested references through GC, reflection stores, and failures.
The independently authored PE fixture exercises ARRAY TypeSpecs, the special
constructor, `Get`, `Set`, and `Address` without the source emitter.

Validation is deliberately deferred until E01 is assembled. Planned commands:

```sh
node --test tests/a05-05-arrays.test.js
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/arrays --output artifacts/a05-arrays
node tests/a05-05-benchmark.js
```

The benchmark records cold, warm median, p95/p99, managed allocation counts, and
observed host-heap change with Node/platform/architecture. Host-heap change is not
an exact JavaScript allocation count. The native runner records SDK/runtime
versions, exact commands, DLL hashes, and same-DLL native/CIL output. Unit or
synthetic fixture success alone is not native or browser qualification. Node,
browser, and native targets still need their independent assembled-epic gates.
