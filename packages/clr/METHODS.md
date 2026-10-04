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

`isAbstract`, `isFinal`, `isVirtual`, `isHideBySig` and `isSpecialName` project
individual MethodAttributes bits. `isPrivate`, `isFamilyAndAssembly`, `isAssembly`,
`isFamily`, `isFamilyOrAssembly` and `isPublic` compare the masked access value;
PrivateScope and the reserved access value match none of them. These predicates
read no signature, Param row or body, and do not validate combinations of flags.
Raw `flags` and `implementationFlags` remain unchanged.

Lazy `callingConvention` projects the cached signature into Reflection's numeric
CallingConventions: Standard=1, VarArgs=2, HasThis=32 and ExplicitThis=64. Only the
ECMA VARARG convention maps to VarArgs; other decoder-supported conventions map
to Standard, with the two receiver bits preserved. Generic arity is not a
CallingConventions flag. This mirrors [CoreCLR v10.0.5 SignatureNative](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/runtimehandles.h)
and [MethodBase attribute predicates](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Reflection/MethodBase.cs).
It is raw header projection, not validation that a MethodDef can execute with a
particular unmanaged or explicit-this convention. Existing signature diagnostics
and limits apply lazily. Queries are O(1) after the existing signature decode,
add no descriptor fields or result allocations, and remain usable through
cooperative unloading.

The new method-attribute fixture independently captures CoreCLR visibility,
virtual/final/abstract/special-name, implementation flags and calling conventions,
including constructors, generic methods and static/instance varargs. Authored
metadata covers all access-mask values, each bit independently, explicit-this and
other decoder-supported conventions, malformed headers, oversized signatures and
unload. SDK 10.0.201/CoreCLR 10.0.5 captured 18 records; all 26 focused Method
tests pass on Node 24.21.0. Syntax/static checks pass (3,029/3,025 modules), and
structure reports 267 existing findings, none in CLR/changed files. Every local
job ran serially through the limiter. Full constructor classification, MethodInfo
ToString, GetBaseDefinition and invocation remain separate capabilities.

On a shared Apple M3 Pro/darwin-arm64, cold attributes/conventions for all 18
records measured median 52.750 µs / p95 138.792 µs; cached convention+visibility
queries measured 0.004479 µs / p95 0.026600 µs. All 200 measured samples are
retained in collection order with exact sources/hashes in
`benchmarks/method-attributes-node24.json`. There is no prior equivalent API or
speed claim. Allocation totals were not measured. These added prototype getters
do not change existing lookup/signature paths or descriptor layouts; no existing
path benchmarks were rerun, as agreed with the root reviewer.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-attributes.mjs tests/fixtures/clr-method-attributes
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-method-attributes.mjs
```

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

The asynchronous [class base-definition service](METHOD-BASE-DEFINITION.md)
resolves implicit virtual override roots with explicit diagnostics for unsupported
slot families. Full MethodInfo/ConstructorInfo and ParameterInfo facades, defaults,
overload resolution, virtual dispatch and invocation remain separate increments. Source VM, direct CIL and Rust native/Wasm execution are
not qualified by this host metadata API.

Method and constructor signature strings are documented in [METHOD-DISPLAY.md](METHOD-DISPLAY.md).
