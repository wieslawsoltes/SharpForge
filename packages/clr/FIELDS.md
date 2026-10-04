# Field definition metadata

`RuntimeModule.fieldDefinition(token)` returns a canonical frozen `FieldDesc`.
`fieldDefinitions(typeToken)` returns the canonical frozen declared-field array
in metadata order, including `#-` FieldPtr indirection. Inherited members and
BindingFlags filtering are separate reflection services.

Descriptors expose `name`, `metadataToken`, `declaringType`, `module`, `assembly`,
`loadContext`, raw `flags`, `isStatic`, `isInitOnly` and `isLiteral`. Identity
lookup reads no signature blob or executable body. Lazy `signature` exposes a
deeply frozen CIL field-signature AST, preserving generic variables, arrays and
custom modifiers. It does not resolve TypeRefs or substitute generic arguments.
Lazy [custom modifier token queries](CUSTOM-MODIFIERS.md) expose required and
optional outer modifiers in CoreCLR reflection order.

Lazy `constant` shares the module's raw Constant index with Param metadata.
`module.constant(token)` accepts Field, Param or Property tokens and returns the
same frozen `{type, value}` or `null` when absent. HasDefault flags must agree
with the table. Owner validation remains lazy per owner-table kind; Field-owner
validation does not run during Param-only access. Primitive
values use the public CIL codec; safe 64-bit integers are Numbers, larger values
are BigInts, and null constants have type 18. There is no enum boxing or
custom-attribute interpretation.

Methods and fields share one schema-driven definition ownership service, with
separate module-owned caches. Cold traversal is O(TypeDef + member + pointer)
rows, bounded to 100,000 combined rows. Warm descriptor and signature reads reuse
their cached identities. The shared Constant table is indexed once in O(rows),
bounded to 100,000 rows, as is each owner table queried directly through
`module.constant`. Field names are limited to 4,096 UTF-8 bytes; field
signature and Constant blobs to 1 MiB, checked before decoding or copying.
Malformed signatures, ownership or defaults produce `SFCLR005`; limits produce
`SFCLR007`. Signature nesting uses existing CIL decoder bounds. Retained metadata
remains usable during cooperative unloading; this synchronous service introduces no async
cancellation operation.

The native fixture covers classes, a generic class, an enum and a struct with
instance/static/private/readonly/volatile/literal fields, generic variables,
arrays, primitive constants and null. SDK 10.0.201/CoreCLR 10.0.5 captured 16 fields;
all 28 affected field/method/parameter/Buffer tests pass on Node 24.21.0. The direct
Constant owner bound regression failed before its fix. Static checks pass; the
structure report has 284 existing findings, none in CLR. Validation ran serially.

```sh
node scripts/limited.js node packages/clr/tools/capture-field-definitions.mjs tests/fixtures/clr-field-definitions
node scripts/limited.js node --test --test-concurrency=1 tests/clr-fields-*.test.js tests/clr-methods-*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-field-definitions.mjs
```

FieldInfo value access, storage layout, RVA initialization, PropertyInfo/EventInfo,
accessors, binding and execution remain separate increments. Source VM, direct
CIL and Rust native/Wasm execution are not qualified by this host metadata API.

On the shared Apple M3 Pro/darwin-arm64 host, final cold all-fixture field metadata
measured median 97.709 µs / p95 233.333 µs; cached field identity/signature measured
0.015529 µs / 0.045383 µs. Initial field measurements were 47.666/123.875 µs and
0.014671/0.034604 µs respectively. The existing MethodDef benchmark controls were:

| MethodDef version | Cold median / p95 (µs) | Cached median / p95 (µs) |
| --- | --- | --- |
| Parent `0bfff15e` | 26.208 / 68.750 | 0.006612 / 0.026837 |
| Initial shared index | 27.042 / 86.667 | 0.010229 / 0.031575 |
| Final `3a36e4b0` | 25.417 / 59.083 | 0.010496 / 0.035254 |

The final cached-method cost is +3.884 ns median / +8.417 ns p95 per query. The
root reviewer explicitly accepted this cost for the shared ownership service;
the final implementation uses a single Map lookup on cached hits. This shared-host
sample does not establish statistical significance or a speedup. There is no
previous equivalent field implementation, and exact allocations were not measured.
The JSON evidence retains all measurements, source identities and fixture hash.
