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

Lazy `constant` shares the module's raw Constant index with Param metadata.
`module.constant(token)` accepts Field, Param or Property tokens and returns the
same frozen `{type, value}` or `null` when absent. HasDefault flags must agree
with the table. Owner validation remains lazy per owner-table kind, so malformed
Field constants do not change when Param-only metadata access fails. Primitive
values use the public CIL codec; safe 64-bit integers are Numbers, larger values
are BigInts, and null constants have type 18. There is no enum boxing or
custom-attribute interpretation.

Methods and fields share one schema-driven definition ownership service, with
separate module-owned caches. Cold traversal is O(TypeDef + member + pointer)
rows, bounded to 100,000 combined rows. Warm descriptor and signature reads reuse
their cached identities. The shared Constant table is indexed once in O(rows),
bounded to 100,000 rows. Field names are limited to 4,096 UTF-8 bytes; field
signature and Constant blobs to 1 MiB, checked before decoding or copying.
Malformed signatures, ownership or defaults produce `SFCLR005`; limits produce
`SFCLR007`. Signature nesting uses existing CIL decoder bounds. Public module
queries honor context disposal; this synchronous service introduces no async
cancellation operation.

The native fixture covers classes, a generic class, an enum and a struct with
instance/static/private/readonly/volatile/literal fields, generic variables,
arrays, primitive constants and null. Validation is pending the serial slot.

```sh
node scripts/limited.js node packages/clr/tools/capture-field-definitions.mjs tests/fixtures/clr-field-definitions
node scripts/limited.js node --test --test-concurrency=1 tests/clr-fields-*.test.js tests/clr-methods-*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-field-definitions.mjs
```

FieldInfo value access, storage layout, RVA initialization, PropertyInfo/EventInfo,
accessors, binding and execution remain separate increments. Source VM, direct
CIL and Rust native/Wasm execution are not qualified by this host metadata API.
