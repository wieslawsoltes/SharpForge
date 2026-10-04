# Parameter metadata

`MethodDesc.parameters` returns a canonical frozen array in signature-position
order. `returnParameter` represents position −1. `module.methodParameters(token)`
returns the same frozen `{parameters, returnParameter}` record. Names and raw
flags come from Param rows; `isIn`, `isOut` and `isOptional` expose their flag bits.
Each ParameterDesc retains its `method`, `module` and immutable `signatureType`
AST. Its `member` is the method, or the owning property for a
[property index-parameter projection](PROPERTY-PARAMETERS.md). The `method`
always remains the defining accessor. No type references or executable bodies
are loaded. Lazy [custom modifier token queries](CUSTOM-MODIFIERS.md) expose
required and optional outer modifiers, including return parameters.

`parameter.toString()` returns a cached Reflection-style type name and metadata
name. It follows [ParameterInfo.ToString](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Reflection/ParameterInfo.cs#L89):
by-reference types retain `&` (for example `Int32& value`), and a missing name
adds no separator. A present empty name preserves the trailing space. Return
parameters, constructor arguments and property index-parameter projections use
the same behavior. Rendering does not inspect constants, activate attributes,
resolve assemblies or read method bodies.

The existing bounded [method type formatter](METHOD-DISPLAY.md) supplies primitive,
generic, nested and array naming, modifier suppression, depth/node/name limits
and explicit unsupported-type diagnostics. The final type-plus-name result has
a 16,384-character limit checked before concatenation. Successful strings are
cached in existing descriptor state only after a display query; ordinary parameter
metadata/constant reads add no display work or eager cache storage. Metadata remains usable
through cooperative unloading. This synchronous operation adds no cancellation
contract. Default-value evaluation and generic instantiation remain separate.

Six authored tests and a mandatory native fixture for 16 parameter displays are
prepared. The C# source covers arguments, missing/empty return names, constructor
arguments, generic/nested types, ref/in/out and property index parameters.
Capture, focused tests, new-API timings and static/structure checks are pending
the shared serial slot. No passing qualification is claimed for this extension.

Param rows are optional. Missing rows receive canonical positional descriptors
with name `null`, flags 0 and metadata token 0. A zero token is this metadata API's
explicit absence marker, not a usable Param token. Real rows preserve their tokens.
Present rows with a zero name index have the empty string name.
Sequence numbers determine position even when `#-` ParamPtr order differs.
Duplicate sequences, out-of-range positions and reused Param rows are rejected.

`parameter.constant` lazily returns a frozen `{type, value}` from the ECMA Constant
table, or `null` when absent. A null-reference constant is `{type: 18, value: null}`.
The value comes from the public CIL Constant codec; Int64/UInt64 use Number when
exactly representable as a safe integer and BigInt otherwise.
This projects raw metadata, with no enum boxing, coercion or custom-attribute
default evaluation. DecimalConstantAttribute, DateTimeConstantAttribute, optional
argument binding and full Reflection DefaultValue semantics remain separate work.

The module owns the positional/constant caches. Traversal is linear in visited
Param rows plus the once-indexed Constant table; repeated descriptor/constant
reads reuse their frozen results. Combined Param/ParamPtr/Constant rows and total
parameter descriptors (including omitted rows and return parameters) are each
bounded to 100,000, names to 4,096 UTF-8 bytes, and Constant blobs to the existing
codec's 1 MiB limit. Heap views are checked before names are decoded or blobs copied.
`RuntimeModule.string(index, {maxBytes})` and `blob(index, {maxBytes})` expose these
optional preflight bounds; invalid limits produce `SFCLR006`. Signature limits come from the MethodDesc decoder. Malformed
rows, flag/Constant disagreement, duplicate constants or malformed payloads
produce `SFCLR005`; bounds produce `SFCLR007`. This synchronous metadata service
adds no cancellable asynchronous operation.

The native fixture records three methods with seven arguments and three return
parameters using independent CoreCLR reflection and SRM. It covers primitive and
null defaults, an Int64 constant, ref/out/optional flags and a return marshal flag.
Authored metadata fixtures cover missing rows, ParamPtr order and malformed data.

```sh
node scripts/limited.js node packages/clr/tools/capture-parameters.mjs artifacts/clr-parameters
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-*.test.js tests/clr-context-buffer-ownership.test.js
node scripts/limited.js node packages/clr/tools/benchmark-parameters.mjs
```

The SDK 10.0.201/CoreCLR 10.0.5 capture and all 22 affected tests pass on Node
24.21.0, including existing method/generic-parameter and Buffer ownership cases.
The two heap materialization regressions failed before their fixes. Static checks
pass; the structure report has 284 existing findings, none in CLR. All local
runners were serialized through the machine-wide limiter.

This first implementation has no previous equivalent benchmark. On a shared
Apple M3 Pro/darwin-arm64 with Node 24.21.0, cold positional metadata and constants
for all three fixture methods measured median 43.792 µs / p95 109.292 µs; cached
parameter constant access measured median 0.009042 µs / p95 0.025696 µs. Exact
allocations were not measured and no speedup is claimed. JSON evidence is saved in
`benchmarks/parameters-node24.json`.

ParameterInfo invocation, dynamic defaults and source VM/direct CIL/Rust
native/Wasm execution are not qualified by this host metadata API.
