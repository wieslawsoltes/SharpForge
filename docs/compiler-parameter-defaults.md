# Optional parameter metadata and assembly boundaries

`compileToAssembly` and `compileToReferenceAssembly` preserve optional parameter
defaults in the emitted metadata. The direct CIL caller also consumes defaults
from imported assemblies.

## Representation

Primitive, enum, string and null defaults use the CLI Constant table and the
Param table's Optional and HasDefault flags. Character constants retain their
UTF-16 code unit; 64-bit integral constants retain their complete value.
`default(S)` and `default(T)` use the CLI null constant representation.

Decimal defaults use `DecimalConstantAttribute`, with the original scale,
sign and all three 32-bit magnitude words. Their Param rows are Optional;
reflection derives HasDefaultValue from the attribute. The importer reads
both signed and unsigned constructor encodings without converting the value
through a JavaScript floating-point number. Invalid attribute payloads do not
become fabricated constants.

Synthesized delegate `Invoke` parameters retain optional constants and params
markers. Arrays use `ParamArrayAttribute`; C# 13 non-array params collections
use `ParamCollectionAttribute`.

## Calls

At an omitted argument, source constants and imported scalar defaults are
normalized to the same compiler constant representation. Numeric conversions,
boxing and nullable construction preserve the parameter's actual CLR type.
A nullable default such as `int? value = 5` emits a constructed nullable value,
while an absent value emits the type's default.

## Qualification

`tests/compiler-parameter-default-metadata.test.js` checks the metadata of both
assembly APIs, synthesized delegates, mandatory parameters, nullable and struct
defaults, decimals and params collections. It also imports an emitted library,
checks the imported defaults, and executes a separately emitted consumer on
real .NET when an SDK and reference pack are available.

`packages/compiler/test/cil-emission/reference-fixtures/parameter-defaults.cs`
reflects parameter defaults and attributes, including Decimal.MaxValue and a
decimal with trailing zeros. Its `.out` file was captured from Roslyn with SDK
10.0.201; the SharpForge assembly compiled against reference pack 10.0.5 prints
the same output on .NET 10.0.5. Reproduce with:

```sh
node scripts/limited.js node --test tests/compiler-parameter-default-metadata.test.js
node scripts/limited.js node packages/compiler/test/cil-emission/verify-dotnet.mjs --references --only parameter-defaults
```

Set `DOTNET_ROOT` and `DOTNET` to the installed SDK when it is outside the usual
locations. SDK-dependent cases report a skip when those requirements are absent.
