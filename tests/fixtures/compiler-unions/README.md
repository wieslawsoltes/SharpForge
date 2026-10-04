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
on CoreCLR through the direct CIL emitter. The CIL VM rejects managed-reference fields and generic aggregate
owners; focused tests assert those actual boundaries. The source bytecode VM reports `SF2200` for source structs.
These VM paths remain unsupported, and no browser/Wasm qualification is implied by the native results.

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

The retained `qualification/native-10.0.201.json` records a passing comparison on SDK 10.0.201 / CoreCLR 10.0.5.
Both programs produced ten `True` lines, no stderr and exit code 0. The compiler uses the same verified reference
pack as the ordinary-C# reference build. `qualification/focused.log` records 62 passing focused union and adjacent
record, pattern, nullable-loop and semantic-model tests, with zero skips. Runtime assertions use actual CoreCLR
output through `native-test.js`; the expected strings are proposal expectations and are not labelled Roslyn pins.

The initial run exposed a metadata-plan filter that omitted parameterized synthesized struct constructors, and
the prior runtime tests assumed aggregate storage beyond the CIL VM's actual profile. The constructor filter was
corrected, all output assertions were preserved on CoreCLR, and explicit VM rejection tests were added. Five
additional regressions were reproduced before fixing constructor accessibility, ref-returning Value reads,
direct-Value logical/constant boundaries, same-source `or` narrowing and sequential nullable switch flow.
