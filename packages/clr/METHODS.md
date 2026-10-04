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

`method.genericParameters` and `module.methodGenericParameters(methodToken)` add
canonical MethodDef-owned GenericParam descriptors. The shared generic metadata
index supplies names, positions, attributes and raw constraint tokens. A parameter
has `genericParameterOwner` and `declaringMethod` equal to its canonical MethodDesc,
and `declaringType` equal to that method's type. `module.genericParameter(token)`
works for either metadata owner kind. Type-owned parameters have a null
`declaringMethod`. Parameter arrays, including empty arrays, are memoized on each
method. Requesting them lazily validates that the parameter count matches the
method signature's generic arity; mismatches produce `SFCLR012`, while arity over
1,024 produces `SFCLR007`.

The extended generic-parameter fixture captures four methods with four parameters
covering value/reference/default-constructor and dependent/interface constraint
tokens. SDK 10.0.201/CoreCLR 10.0.5 capture and all 13 affected method/generic
tests pass on Node 24.21.0. Static checks pass; the structure report has 267
existing findings and none in CLR. All local validation ran serially.
The new method-parameter benchmark on a shared Apple M3 Pro/darwin-arm64 measured
cold all-fixture median 40.708 µs / p95 119.750 µs and cached array access median
0.001925 µs / p95 0.017029 µs. The prior type-parameter benchmark used the same
expanded fixture image for both implementations: parent/head cold medians were
35.166/32.292 µs, p95 77.042/73.291 µs; warm medians 0.034146/0.031488 µs,
p95 0.053621/0.039825 µs. These are regression controls on a shared machine,
not speedup claims. Exact allocations were not measured; JSON evidence is saved.
Constraint resolution/enforcement and method instantiation remain unsupported;
these metadata descriptors report `isLoaded: false` and load no executable body.

`getMethodBody()` delegates to the module's existing body cache and returns a
defensive snapshot, including copied IL bytes. A zero RVA returns `null`.
`module.methodBodyReadCount` remains zero until a body is actually decoded and
increments only once per method. Holding a descriptor retains its module and
assembly, consistent with existing collectible metadata lifetimes.

The first lookup indexes MethodList ownership in O(TypeDef + MethodDef + MethodPtr)
rows, bounded to 100,000 combined rows. The module owns all caches, and repeated
identity/signature reads use indexed lookups. Names are bounded to 4,096 UTF-16
code units, with a generous 16 KiB UTF-8 ceiling checked before string decoding.
Signature blobs are bounded to 1 MiB before defensive copying; decoding also
uses the existing CIL depth/node limits. Invalid
or duplicate ownership, unowned methods and invalid tokens produce `SFCLR005`;
row/name/blob limits produce `SFCLR007`. This synchronous metadata service introduces
no cancellable asynchronous operation.

The heap-preflight regression reproduced both premature materializations before
this correction. All three focused regressions pass after the guard changes,
including non-ASCII names at the existing UTF-16 limit. Node 24.21.0 syntax/static
checks pass (2,471/2,467 modules); the structure report has no CLR findings.
This bounded fix does not change cached identity/signature lookup paths.

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
the six focused method-definition tests pass on Node 24.21.0. Static checks pass,
and the structure report contains 264 existing findings with none in CLR.
Validation ran serially through the limiter; broader execution qualification was
not run. Method-owned parameter validation is recorded separately above.

The first implementation has no prior equivalent benchmark. On a shared Apple
M3 Pro/darwin-arm64 with Node 24.21.0, cold indexing and identity creation for all
fixture types measured median 22.584 µs / p95 45.500 µs. Cached method identity and
signature lookup measured median 0.00793 µs / p95 0.02924 µs. Exact allocation
counts were not measured; no speedup is claimed. The committed JSON records
host details and percentiles.

Full MethodInfo/ConstructorInfo and ParameterInfo facades, defaults,
GetBaseDefinition, overload resolution, virtual dispatch and invocation are
separate increments. Source VM, direct CIL and Rust native/Wasm execution are
not qualified by this host metadata API.
