# Custom modifier token queries

`FieldDesc`, `PropertyDesc` and `ParameterDesc` expose lazy
`requiredCustomModifierTokens` and `optionalCustomModifierTokens`. Each returns
a canonical frozen array of module-relative TypeDef, TypeRef or TypeSpec tokens.
These are unresolved metadata identities; the query does not load modifier types
or executable bodies. Empty results are frozen and shared.

Only the outer custom-modifier prefix at the selected signature position is
included. Traversal stops before a byref, pointer, array or other type constructor;
modifiers inside those types or generic arguments remain in the signature AST.
Duplicates are preserved. Each kind is returned in reverse encoded order, matching
[CoreCLR v10.0.5 Signature_GetCustomModifiersAtOffset](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/runtimehandles.cpp).
This API exposes tokens rather than Reflection's resolved Type objects.

Fields use their field type, properties their return type, and method parameters
or return parameters their positional method signature type. A projected property
index parameter uses the **property signature** for custom modifiers, while its
existing `signatureType` remains the accessor's metadata type. This distinction
matches [CoreCLR RuntimeParameterInfo](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/System.Private.CoreLib/src/System/Reflection/RuntimeParameterInfo.cs).
An accessor parameter absent from the property signature is rejected lazily when
its modifier query is requested (`SFCLR005`). Other property/accessor signature
compatibility checks remain a separate binding service.

The shared reader walks O(prefix length) once per descriptor and caches both
frozen lists. It accepts at most 64 prefix nodes (`SFCLR007`) and checks each
modifier token's table and nonzero row extent before returning it (`SFCLR005`).
The existing signature decoder's depth/node limits and 1 MiB blob preflight also
apply. This does not validate the referenced type's semantic suitability as a
modifier. Retained descriptors stay usable during cooperative unloading; this
synchronous metadata query adds no asynchronous cancellation operation.

Authored tests cover mixed kinds/order, duplicates, cache identity, nested
modifiers, property versus accessor signatures, invalid token extents, missing
positions, prefix bounds and unload. The independent persisted Reflection.Emit
fixture compares real CoreCLR field, property, method return/argument and property
index-parameter queries, including TypeDef and TypeRef modifiers. TypeSpec token
extent handling has authored coverage; resolved TypeSpec semantics are not claimed.
SDK 10.0.201/CoreCLR 10.0.5 captured nine independent records; all 45 affected
Field/Property/Method tests pass on Node 24.21.0. Syntax/static checks pass
(2,678/2,674 modules); structure reports 269 existing findings, none in CLR or
changed files. All local validation ran serially through the limiter.

On a shared Apple M3 Pro/darwin-arm64, new modifier queries for all nine records
measured cold median 44.667 µs / p95 165.417 µs; cached field required+optional
queries measured 0.009167 µs / p95 0.026138 µs. The unchanged property-parameter
control used exact parent c652049f and product 5e11101e with identical script and
fixture: cold medians 88.709/89.458 µs and p95 317.459/366.667 µs; cached medians
0.009554/0.009542 µs and p95 0.022517/0.022608 µs. Cold p95 increased by
49.208 µs (+15.5%) and cached p95 by 0.0917 ns. The root reviewer explicitly
accepted these costs for the bounded lazy modifier capability and one private
cache slot per descriptor; unchanged access paths do not traverse modifiers.
This shared-host pair cannot establish causality; no general speed or significance
claim is made. All 600 raw measured samples, source commits and fixture/script
hashes are retained in `benchmarks/custom-modifiers-node24.json`. Added descriptor
footprint and allocation totals were not measured. No benchmark was repeated or retuned.

```sh
node scripts/limited.js node packages/clr/tools/capture-custom-modifiers.mjs tests/fixtures/clr-custom-modifiers
node scripts/limited.js node --test --test-concurrency=1 tests/clr-properties-*.test.js tests/clr-fields-*.test.js tests/clr-methods-*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-custom-modifiers.mjs
```

Inherited member views, modifier type loading, overload binding and invocation
remain separate work. Source VM, direct CIL and Rust native/Wasm execution are not
qualified by this host metadata service.
