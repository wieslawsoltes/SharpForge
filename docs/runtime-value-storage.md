# Sequential scalar struct storage

This focused increment of [T03.2 / #1365](https://github.com/wieslawsoltes/SharpForge/issues/1365)
adds direct-CIL storage for reference-free sequential user structs. It depends
on the value-layout/`sizeof` leaf. A value is a frozen `{valueType, fields}`
record with a VM-owned MethodTable and frozen nested fields. Loads and
assignments copy values through the existing storage adapter. Scalar fields
retain their normal integer, floating, native, enum and Decimal normalization.

`initobj`, `ldobj`, `stobj`, `cpobj`, `ldfld`, `stfld` and `ldflda` now work for
these structs in locals, arguments, static/object fields and array elements.
Interior addresses retain the original location plus a frozen field path;
replacing an enclosing struct does not leave a stale JavaScript alias. Stores
rebuild enclosing immutable records, preserving value-copy semantics. Ordinary
same-VM snapshots can safely share those immutable records without schema or
GC changes. Each construction/copy is bounded to 65,536 expanded field slots.

Generated managed addresses include an opaque VM owner. Cross-VM addresses,
expired frame addresses, wrong value-type identities and readonly stores reject
explicitly. Parked frame lookup reuses the existing scheduler frame inventory.
Copying a struct into object storage requires boxing and is rejected here.

Managed-reference fields, auto/explicit layouts, Nullable, readonly and
byref-like structs, scoped/modified signatures, user-struct boxing, instance
constructors/methods and constrained calls remain outside this leaf. User
struct constructors reject before allocation; they never allocate a
class-shaped substitute. Existing generic-call restrictions remain unchanged;
aggregate `cpobj` admission is limited to a concrete TypeDef operand.
Source custom-struct lowering, raw memory, portable snapshots and aggregate GC
qualification remain pending; this increment does not close #1365 or #1366.

Focused regressions use independently authored CIL, copied and interior
mutations, normalized narrow stores, arrays/object/statics, managed by-value
calls, ordinary replay and negative boundaries. Native fixture source is in
`tests/fixtures/a05/value-storage`; `expected.txt` is an unmeasured qualification
target. Initial serial validation at `723bfb4e` passed 99 of 102 tests and
exposed three existing direct-field-handler regressions. Explicit operation
adapters fixed those without changing assertions; registered framework values
also retain their existing storage path. At `6017ca32`, all 34 affected struct,
address and scalar-field cases passed, plus four existing framework boxing/GC
cases across source, canonical, CIL and reassembled execution. Tests used Node
24.21.0, 512 MB and concurrency 1. Core static/build evidence is on the PR;
native tools and performance qualification remain deferred. After merging main
`9d09838b`, all 29 struct/address and newly extracted source-dispatch integration
tests passed at `26426fa0`; only the inventory generator and generated inventory
needed conflict resolution, preserving both main and struct shape additions.

Root owns the serial queue:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-value-storage.test.js tests/a05-managed-address.test.js tests/a05-frame-pool.test.js tests/a05-scalar-slot-loads.test.js tests/a05-scalar-field-loads.test.js tests/a05-value-layout-sizeof.test.js
```
