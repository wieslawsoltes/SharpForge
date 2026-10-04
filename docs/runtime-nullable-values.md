# Direct CIL Nullable values

This bounded [T03.3 / #1366](https://github.com/wieslawsoltes/SharpForge/issues/1366)
increment reuses canonical MethodTables, closed generic call resolution and
the existing scalar/sequential-value storage adapters. A frozen
`{nullableType, hasValue, value}` record holds either no payload (`null`) or an
independent normalized value. No managed reference is hidden inside it.

Guest CIL supports defaults and `initobj`, both `call` and `newobj` constructor
forms, `HasValue`, `Value`, both `GetValueOrDefault` overloads and `ToString`.
An empty `Value` throws `InvalidOperationException`. Normal slots, arguments,
object/static fields and arrays reuse the existing declared storage boundary.
Same-VM snapshots preserve immutable payloads and canonical type identity.
Opt-in stack byte budgets use the aligned Nullable layout, including HasValue,
so wide payloads are charged fully during admission and snapshot preflight.

Boxing an empty Nullable returns null; boxing a present value copies and boxes
the underlying T with T's header. `unbox.any Nullable<T>` reconstructs an empty
value from null or a present value from an exact T box. A different box type
throws `InvalidCastException`, including an enum box compatible with T only
through [ordinary enum unboxing](runtime-enum-unboxing.md). The constructor dispatch leaf also retains the
existing Decimal path; neither Nullable nor Decimal allocates a class stand-in.

Underlying values are limited to admitted primitive/native/enum/Decimal and
reference-free sequential user values. Nested Nullable, reference, ref-like,
opaque/dynamic framework values and unsupported user layouts reject explicitly.
Struct fields that themselves contain Nullable remain outside sequential struct
storage. Direct `unbox Nullable<T>` interior addresses,
generic user-value instance calls, source frontend lowering,
lifted operators, generic Nullable utility methods, portable snapshots and
reference-containing aggregate GC remain pending. This does not close #1366.

Prepared tests execute independently authored guest CIL, including both ABI
settings, real constructors, user structs, Decimal, arrays and collection,
managed faults, copy/replay identity and explicit unsupported cases. Native
fixture output is a deferred reference target, not measured evidence. Serial
Node 24 validation at `1576af76` passed all 108 focused tests across Nullable,
struct boxing/storage, Decimal, generic calls, layouts and CIL stack budgets.
Broad native, browser and performance qualification remains deferred.

Root owns the serial validation queue:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-nullable-cil.test.js tests/a05-value-boxing.test.js tests/a05-value-storage.test.js tests/a05-decimal-cil.test.js tests/a05-02-generic-calls.test.js tests/a05-value-layout-sizeof.test.js
node scripts/limited.js dotnet run --project tests/fixtures/a05/nullable/Nullable.csproj -c Release
```
