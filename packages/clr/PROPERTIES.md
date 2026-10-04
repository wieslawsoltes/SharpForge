# Property metadata identities

`RuntimeModule.propertyDefinition(token)` returns a canonical frozen `PropertyDesc`.
`propertyDefinitions(typeToken)` returns a frozen declared-property array in
PropertyMap order, honoring `#-` PropertyPtr indirection. Descriptors expose
`name`, raw `flags`, `metadataToken`, `declaringType`, `module`, `assembly` and
`loadContext`. Identity lookup reads neither signatures nor accessor methods.

Lazy `signature` is an owned, deeply frozen CIL property AST; `parameters` on
that AST describes index parameter types, and `returnType` describes the property
type. `isStatic` reads its HasThis bit. Variables, arrays and custom modifiers
remain unresolved metadata. Lazy `constant` reuses the module's raw Constant
service, with no enum boxing or custom-attribute default evaluation.
Lazy [custom modifier token queries](CUSTOM-MODIFIERS.md) read the property type's
outer modifier prefix.

Lazy [`indexParameters`](PROPERTY-PARAMETERS.md) projects accessor Param metadata
into canonical ParameterDesc objects whose owning `member` is this property.

`getMethod`, `setMethod` and frozen `otherMethods` lazily link canonical MethodDesc
objects; missing getter/setter roles are `null`. `module.propertyAccessors(token)`
returns the same cached `{getMethod, setMethod, otherMethods}` record. The index
checks valid role bits, method/association tokens, matching declaring types and
rejects duplicate getter/setter roles or repeated methods. It loads no method
signature or body and applies no visibility filter. CLS naming, visibility and
signature conventions are not treated as mandatory metadata validity rules;
see [ECMA-335 II.22.28 and II.22.34](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).

The shared member index traverses O(TypeDef + PropertyMap + Property + PropertyPtr)
rows, bounded to 100,000 combined rows; duplicate map owners/list starts and
unowned properties are rejected. Accessor indexing is O(MethodSemantics + Property),
bounded to 100,000 combined rows, then per-property results are memoized. Existing
method-identity limits apply when linking methods. Names are bounded to 4,096
UTF-8 bytes and signature/default blobs to 1 MiB before decoding/copying. Invalid
metadata yields `SFCLR005`, limits `SFCLR007`. Descriptors retain their loaded
module and remain usable through cooperative context unloading; new loads are
rejected after unloading begins. This synchronous metadata service has no async
cancellation operation.

The native fixture covers virtual/overridden, static, private setter, protected,
write-only, generic, interface, struct and indexed properties. Authored metadata
adds Other links, raw constants, omitted accessors and malformed/oversized cases.
SDK 10.0.201/CoreCLR 10.0.5 captured nine properties; all 34 affected property,
field, method and Buffer-ownership tests pass on Node 24.21.0. Syntax checks
cover 2,142 modules with no errors; static analysis covers 2,138 modules.
The structure report has 284 existing findings and none in CLR. All validation
ran serially through the limiter.

On a shared Apple M3 Pro/darwin-arm64, new property cold indexing/signatures/
accessors measured median 51.292 µs / p95 147.542 µs; cached identity/signature
queries measured 0.008071 µs / p95 0.036854 µs. Parent/head MethodDef controls
measured cold medians 18.084/19.792 µs and p95 56.541/51.875 µs; cached medians
0.006258/0.005904 µs and p95 0.027800/0.028154 µs. FieldDef cold medians were
46.083/48.000 µs and p95 132.541/141.833 µs; cached medians 0.012729/0.007662 µs
and p95 0.032346/0.037463 µs. The root reviewer accepted the bounded absolute
costs: MethodDef cold median +1.708 µs, FieldDef cold p95 +9.292 µs and cached
p95 +5.117 ns. These shared-machine controls make no significance or speedup
claim. Allocation counts were not measured. Exact source identities, identical
control fixture hashes and all percentiles are committed in the benchmark JSON.

```sh
node scripts/limited.js node packages/clr/tools/capture-property-definitions.mjs tests/fixtures/clr-property-definitions
node scripts/limited.js node --test --test-concurrency=1 tests/clr-properties-*.test.js tests/clr-fields-*.test.js tests/clr-methods-*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-property-definitions.mjs
```

PropertyInfo value access, BindingFlags enumeration,
inherited-member hiding, generic substitution, EventInfo and execution remain
separate increments. Source VM, direct CIL and Rust native/Wasm execution are
not qualified by this host metadata API.
