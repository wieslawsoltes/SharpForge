# Method definition identities

`RuntimeModule.methodDefinition(token)` returns a canonical frozen `MethodDesc`
for a MethodDef in that module. `methodDefinitions(typeToken)` returns a frozen
declared-method array in metadata list order, including constructors and private
members. Lists honor uncompressed `#-` MethodPtr indirection. These are metadata
queries; they do not filter BindingFlags or include inherited members.

Descriptors expose `name`, `metadataToken`, `declaringType`, `module`, `assembly`,
`loadContext`, raw `flags`, raw `implementationFlags` and `isStatic`. Identity
lookup reads only ownership rows and names. It does not resolve type references,
decode signatures, build virtual slots or load executable bodies. Repeated
lookups in a module share identity; different loaded modules remain distinct.

The lazy `signature` getter uses the public CIL decoder and caches a deeply frozen
signature AST. A malformed blob, a non-method signature or a receiver/static flag
mismatch produces `SFCLR005` only when the signature is requested. The original
VAR/MVAR slots are preserved. No generic method instantiation is implied.

Canonical [parameter metadata](PARAMETERS.md) adds positional and return
descriptors, raw Param flags and lazy ECMA Constant values.

`getMethodBody()` delegates to the module's existing body cache and returns a
defensive snapshot, including copied IL bytes. A zero RVA returns `null`.
`module.methodBodyReadCount` remains zero until a body is actually decoded and
increments only once per method. Holding a descriptor retains its module and
assembly, consistent with existing collectible metadata lifetimes.

The first lookup indexes MethodList ownership in O(TypeDef + MethodDef + MethodPtr)
rows, bounded to 100,000 combined rows. The module owns all caches, and repeated
identity/signature reads use indexed lookups. Names are bounded to 4,096
characters; signature decoding uses the existing CIL depth/node limits. Invalid
or duplicate ownership, unowned methods and invalid tokens produce `SFCLR005`;
row/name limits produce `SFCLR007`. This synchronous metadata service introduces
no cancellable asynchronous operation.

The native fixture in `tests/fixtures/clr-method-definitions/Program.cs` records
CoreCLR reflection attributes, owner tokens, signatures and raw method IL for
interfaces, abstract and overridden methods, overloads, constructors, and generic
type/method variables. The accompanying metadata fixtures cover lazy errors,
pointer-table ownership and defensive body copies.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-definitions.mjs artifacts/clr-method-definitions
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-method-definitions.mjs
```

The SDK 10.0.201/CoreCLR 10.0.5 capture contains 14 methods across five types;
the six focused tests pass on Node 24.21.0. Static checks pass, and the structure
report contains 264 existing findings with none in CLR. Validation ran serially
through the limiter; broader execution qualification was not run.

The first implementation has no prior equivalent benchmark. On a shared Apple
M3 Pro/darwin-arm64 with Node 24.21.0, cold indexing and identity creation for all
fixture types measured median 22.584 µs / p95 45.500 µs. Cached method identity and
signature lookup measured median 0.00793 µs / p95 0.02924 µs. Exact allocation
counts were not measured; no speedup is claimed. The committed JSON records
host details and percentiles.

Full MethodInfo/ConstructorInfo
and ParameterInfo facades, defaults, GetBaseDefinition, method-owned generic
parameter identities, overload resolution, virtual dispatch and invocation are
separate increments. Source VM, direct CIL and Rust native/Wasm execution are
not qualified by this host metadata API.
