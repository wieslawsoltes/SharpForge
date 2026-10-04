# Enum unboxing compatibility

Direct CIL `unbox` and `unbox.any` accept a boxed enum as its exact underlying
integer type, a boxed underlying integer as the enum, and two enums with the
same underlying type. Compatibility compares canonical MethodTables, so width
alone is insufficient: `Int32` and `UInt32` remain incompatible, as do `Int16`
and `Char`. Other primitive kinds and different user structs remain distinct.
This is a focused increment of [T03.3 / #1366](https://github.com/wieslawsoltes/SharpForge/issues/1366).

The rule follows CoreCLR's
[Unbox_Helper](https://github.com/dotnet/runtime/blob/6f1d9331b9b477df73982a0fabedefe27f36d8a3/src/coreclr/System.Private.CoreLib/src/System/Runtime/CompilerServices/CastHelpers.cs#L617)
and its [enum primitive classification](https://github.com/dotnet/runtime/blob/6f1d9331b9b477df73982a0fabedefe27f36d8a3/src/coreclr/System.Private.CoreLib/src/System/Runtime/CompilerServices/RuntimeHelpers.CoreCLR.cs#L897).
It is intentionally separate from array element compatibility, which also
reduces signed and unsigned integer pairs.

`Nullable<T>` deliberately requires an exact boxed `T`. A boxed enum cannot
unbox as nullable underlying integer, nor can an underlying integer or a
different enum unbox as `Nullable<E>`. A matching enum box succeeds and null
produces an empty Nullable. This follows the separate CoreCLR
[IsNullableForType](https://github.com/dotnet/runtime/blob/6f1d9331b9b477df73982a0fabedefe27f36d8a3/src/coreclr/System.Private.CoreLib/src/System/Runtime/CompilerServices/CastHelpers.cs#L539)
path; it does not reuse ordinary enum compatibility.

Compatible unboxing does not retag the heap object or change reference casts.
`GetType`, `isinst`, `castclass` and enum formatting still use the original
boxed type. `unbox` returns the existing managed interior location; writes
normalize through the actual box's storage type, and the address roots its
owner across collection. `unbox.any` reads through the requested storage type.
The predicate is constant work with no allocations or cache state.

This change is limited to direct CIL. It adds no source custom-enum lowering,
lifted Nullable operators, user-struct instance/interface dispatch or portable snapshot
format. The wider #1366 acceptance and native/browser/platform qualification
remain open. Native and performance results have not been measured.

Prepared regressions cover all eight enum integer types at their signed or
unsigned boundary, both unboxing instructions, both conversion directions,
same-underlying enum pairs, wrong width/sign/kind, null, preserved box identity,
both VM ABI settings, managed writes, GC, same-VM snapshot replay and disposal.
Four integration cases cover exact/null Nullable enum boxes and reject the
three compatible-but-inexact enum/underlying combinations.
Serial Node 24 validation at `95183e8c` passed all 65 focused enum, Nullable,
struct-boxing, string/enum and cast-integration tests. Broad native/browser and
performance qualification remains deferred.

Queued focused command:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-enum-unboxing.test.js tests/a05-nullable-cil.test.js tests/a05-value-boxing.test.js tests/a05-enums-strings.test.js tests/a05-cast-integration.test.js
```

The .NET 10 source fixture is a deferred reference target; `expected.txt` is
unmeasured. Its `Unsafe.Unbox<T>` calls express native box-interior access only;
the runtime tests emit CIL `unbox` directly and add no `Unsafe` intrinsic.

```sh
node scripts/limited.js dotnet run --project tests/fixtures/a05/enum-unboxing/EnumUnboxing.csproj -c Release
```
