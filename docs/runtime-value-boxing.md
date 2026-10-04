# Reference-free user-struct boxing

This focused [T03.3 / #1366](https://github.com/wieslawsoltes/SharpForge/issues/1366)
increment depends on sequential struct storage. Direct CIL `box` copies an
admitted immutable value into a managed box with the exact canonical MethodTable.
`unbox.any` copies the payload; `unbox` returns an owned address into the box.
Interior writes replace its immutable payload and never alter the original or
an earlier unboxed copy. The address continues to resolve the same box after
whole-payload replacement and keeps that box rooted while held by a live frame.

Existing scalar, enum, Decimal, reference-cast and registered WinUI boxing paths
remain intact. Wrong exact box types throw `InvalidCastException`; null value
unboxing throws `NullReferenceException`. Default `Object.ToString`, `GetType`
and casts use the canonical user type. Ordinary same-VM snapshots share immutable
payloads and independently copy the containing box slot. A heap interior remains
valid until its owner is collected; frame cancellation drops its managed roots.

Nullable and enum-to-underlying unboxing compatibility remain pending. This
leaf adds no user value-type instance/interface calls, source custom-struct
lowering, reference-containing or explicit-layout storage, raw memory, portable
snapshot format or aggregate GC scheme. Registered framework values keep their
existing separate representation. Aggregate `unbox` admission is limited to a
concrete TypeDef operand. This increment does not close #1366.

Prepared tests cover both native ABI settings, copies, interior mutation, an
actual GC instruction with only a byref root, wrong/null types, canonical type
text/casts, snapshots, disposal, foreign payloads and framework compatibility.
The CLR source fixture uses `Unsafe.Unbox<T>` only to express the native box
interior mutation; the independently authored runtime fixture emits `unbox`
directly. It does not add an `Unsafe` intrinsic to the runtime. Its expected
output is an unmeasured qualification target.

No tests, builds, checks or native reference commands were run during preparation.
Root owns the serial queue:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-value-boxing.test.js tests/a05-value-storage.test.js tests/a05-native-width-cil.test.js tests/a05-decimal-cil.test.js tests/a05-enums-strings.test.js tests/a05-cast-integration.test.js tests/a05-scalar-box-formatting.test.js
```

Deferred native reference command:

```sh
node scripts/limited.js dotnet run --project tests/fixtures/a05/value-boxing/ValueBoxing.csproj -c Release
```
