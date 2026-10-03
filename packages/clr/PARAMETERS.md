# Parameter metadata

`MethodDesc.parameters` returns a canonical frozen array in signature-position
order. `returnParameter` represents position −1. `module.methodParameters(token)`
returns the same frozen `{parameters, returnParameter}` record. Names and raw
flags come from Param rows; `isIn`, `isOut` and `isOptional` expose their flag bits.
Each ParameterDesc retains its `method`, `module` and immutable `signatureType`
AST. No type references or executable bodies are loaded.

Param rows are optional. Missing rows receive canonical positional descriptors
with name `null`, flags 0 and metadata token 0. A zero token is this metadata API's
explicit absence marker, not a usable Param token. Real rows preserve their tokens.
Sequence numbers determine position even when `#-` ParamPtr order differs.
Duplicate sequences, out-of-range positions and reused Param rows are rejected.

`parameter.constant` lazily returns a frozen `{type, value}` from the ECMA Constant
table, or `null` when absent. A null-reference constant is `{type: 18, value: null}`.
The value comes from the public CIL Constant codec; Int64/UInt64 use BigInt.
This projects raw metadata, with no enum boxing, coercion or custom-attribute
default evaluation. DecimalConstantAttribute, DateTimeConstantAttribute, optional
argument binding and full Reflection DefaultValue semantics remain separate work.

The module owns the positional/constant caches. Traversal is linear in visited
Param rows plus the once-indexed Constant table; repeated descriptor/constant
reads reuse their frozen results. Combined Param/ParamPtr/Constant rows and total
parameter descriptors (including omitted rows and return parameters) are each
bounded to 100,000, names to 4,096 characters, and Constant blobs to the existing
codec's 1 MiB limit. Signature limits come from the MethodDesc decoder. Malformed
rows, flag/Constant disagreement, duplicate constants or malformed payloads
produce `SFCLR005`; bounds produce `SFCLR007`. This synchronous metadata service
adds no cancellable asynchronous operation.

The native fixture records three methods with seven arguments and three return
parameters using independent CoreCLR reflection and SRM. It covers primitive and
null defaults, an Int64 constant, ref/out/optional flags and a return marshal flag.
Authored metadata fixtures cover missing rows, ParamPtr order and malformed data.

```sh
node scripts/limited.js node packages/clr/tools/capture-parameters.mjs artifacts/clr-parameters
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-parameters*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-parameters.mjs
```

Validation is pending the scheduled serial slot. ParameterInfo invocation,
dynamic defaults and source VM/direct CIL/Rust native/Wasm execution are not
qualified by this host metadata API.
