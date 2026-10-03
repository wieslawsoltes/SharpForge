# A05 T05 array execution

Arrays retain rank, lengths, lower bounds and row-major strides in an immutable
`arrayShape`. The last dimension varies fastest. The actual element MethodTable
controls stores through covariant references, and struct elements use T03 copy
and interior-address rules.

Contracts follow ECMA-335 sixth edition, II.14.2 and I.8.9.1, and the
[.NET 10 Array implementation](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/System.Private.CoreLib/src/System/Array.CoreCLR.cs).
Ordinary incompatible stores throw `ArrayTypeMismatchException`. Reflection
stores use `InvalidCastException` for incompatible objects and `ArgumentException`
for forbidden primitive narrowing. Reflected null resets value elements to zero.

| Surface | Implementation |
| --- | --- |
| Shape | Ranks 1–32, lengths, nonzero/negative lower bounds, row-major strides; zero-bound rank-one allocations become vectors |
| CIL | ARRAY `.ctor`, `Get`, `Set`, `Address`; vector loads/stores, `ldelema` and `readonly.` |
| Reflection | CreateInstance, Rank, Length/LongLength, dimension lengths/bounds, boxed GetValue and checked SetValue |
| Backing | Native typed arrays for primitives and enum underlyings; managed slot arrays for references and copied structs |
| Capacity | Derived from `maxBytes` and element width, optionally restricted by `maxArrayLength`; no fixed one-million-element limit |
| Int64 | Exact native/Int64 lengths and indices are checked before conversion to host addressing; LongLength returns Int64 |
| Algorithms | Copy with overlap, Clear, IndexOf, Resize, Clone and FieldRVA InitializeArray |
| Source | Shared runtime IR for vectors/rectangles and append-only builtin descriptors for Array APIs; compiler adapters own syntax and CIL lowering |
| GC/snapshot | Interior roots, allocating operand roots, typed-buffer copies and shape preflight; writes use the shared heap barrier |

`execution/arrays.js` owns create/get/set/address operations. The separate
`array-storage.js` has no heap dependency and describes element widths, typed
storage copies, reads/writes and raw byte views. `array-calls.js` returns
`{handled, returns, value}` for descriptor-based call/newobj integration. Source
adapters preserve static input types when primitive values require boxing.

Pointer, byref, ref-struct, void and open-generic array elements are rejected.
Lengths must fit the configured heap budget and host typed-array capacity;
Int64 support does not imply unlimited allocation or imprecise Number indexing.
Arbitrary reflection and user-defined equality comparers are separate surfaces.
Raw byte views never expose reference-containing array storage.

Prepared native fixtures are `tests/fixtures/a05/arrays` and
`tests/fixtures/a05/array-leaves`. They cover rectangular/lower-bound arrays,
covariance, struct copies, reflection, bulk algorithms, FieldRVA initializers,
jagged arrays and a four-million-byte allocation under a 32 MiB heap. Independent
PE fixtures exercise ARRAY metadata without relying on the source emitter.

Validation remains deferred until all E01 leaves are assembled. Planned commands:

```sh
node --test tests/a05-05-arrays.test.js tests/a05-array-backing.test.js tests/a05-array-runtime.test.js tests/a05-source-array-builtins.test.js tests/a05-memory-boundaries.test.js
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/array-leaves --output artifacts/a05-array-leaves
node tests/a05-05-benchmark.js
```

The native runner records versions, commands, DLL hashes and same-DLL output.
Benchmarks record cold/warm latency, p95/p99, managed allocations and observed host
heap changes. Browser execution requires its independent bundled-runtime gate;
no execution or performance result is claimed by these fixture definitions.
