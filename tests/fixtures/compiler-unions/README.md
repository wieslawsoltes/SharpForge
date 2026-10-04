# SF-A02-T89 union proposal fixtures

The source assertions follow `dotnet/csharplang` commit
`412dc3023500b69f684c365762e38db6ee7564ea`,
[`proposals/csharp-15.0/unions.md`](https://github.com/dotnet/csharplang/blob/412dc3023500b69f684c365762e38db6ee7564ea/proposals/csharp-15.0/unions.md),
SharpForge revision 1.

The pinned .NET SDK 10.0.201 / Roslyn 5.3.0 build does not parse unions. These are proposal fixtures, not Roslyn
captures. No Roslyn diagnostic IDs or outputs have been invented for union syntax. Existing C# diagnostic IDs
are reused where the proposal invokes existing conversion, pattern or nullability rules.

Coverage follows the proposal's Union types, Union member providers, Union conversions, Union matching,
Union exhaustiveness, Nullability and Union declarations sections. Resolutions in Open questions take precedence
where older prose remains: a union declaration is an ordinary struct; a nullable creation parameter contributes
its underlying case type; the `Value` property's annotation supplies its default null-state; required framework
types are supplied by source or references.

`contracts.js` supplies the required `UnionAttribute` and `IUnion` explicitly. The compiler emits neither contract
when absent. Generated union structs contain one object field and receive ordinary struct copy/default behavior
on direct CIL. The source bytecode VM still reports `SF2200` for source structs; native/Wasm qualification is
recorded by the parent validation batch and is not implied by these tests.

The following open rules remain explicit `SF2202` boundaries: malformed custom basic patterns,
case-compatibility/exhaustiveness decisions that depend on special treatment of direct `Value` property patterns,
inherited/hidden/read-write non-boxing member lookup, and nullable-flow effects of a queried `TryGetValue`
whose out type is not a case type. Direct public getter-only `HasValue` and directly
declared applicable `TryGetValue(out T)` members use the specified non-boxing access path.

`capture-native.mjs` compares the SharpForge-emitted union program in `native-source.cs` with the explicit ordinary
C# struct implementation in `native-reference.cs` on the pinned CoreCLR. It verifies the full toolchain hashes
using the existing oracle helper, records both compiler/runtime commands and the observed results, and fails
on a mismatch. This qualifies the specified lowering; it does not turn the ordinary C# reference into a union
syntax oracle. At the scheduled validation slot, provide `SHARPFORGE_ORACLE_DOTNET` and an output path:

```sh
node scripts/limited.js node tests/fixtures/compiler-unions/capture-native.mjs /absolute/path/union-native.json
```
