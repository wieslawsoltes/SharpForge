# Assembly contexts and metadata lifetimes

`RuntimeModule.typeDefinition(token)` returns a canonical frozen `TypeDesc` for a
TypeDef token. It exposes metadata name/namespace/fullName, flags, interface flag,
module, assembly, context and declaring-type identity. Nested types inherit their
enclosing namespace. Handles keep collectible metadata alive and stay readable
after cooperative unload begins. Repeated lookup is cached; indexing nested
ownership is linear, with 100,000 relevant rows, 128 nesting levels and 4,096 name
characters as limits. Malformed tokens use `SFCLR005`, invalid nested ownership
uses `SFCLR012` / TypeLoadException, and resource limits use `SFCLR007`.

This API is metadata identity only. Graph loading uses the separate explicit
context service below; no reference assembly is loaded and no method body is
decoded by identity lookup. Layout and dispatch remain later batches.

`typeDefinition.genericParameters` and `module.genericParameters(typeToken)`
return the same frozen, position-ordered list of TypeDef-owned GenericParam
descriptors. `module.genericParameter(parameterToken)` returns that canonical
identity directly. Descriptors expose the name, namespace, null full name,
owner/declaring type, position, raw `genericParameterAttributes`, and a frozen
`genericParameterConstraintTokens` list. `String(parameter)` returns its name.
Nested types keep their own metadata parameter owners, including redeclared
enclosing parameters. No base graph or executable method body is loaded.

Generic metadata indexing is linear, limited to 100,000 parameter/constraint
rows, 1,024 parameters per owner and 4,096 name characters. Duplicate positions,
gaps, invalid owners and invalid/duplicate constraint references fail explicitly.
Constraints remain unresolved tokens: their semantic resolution/enforcement and
generic instantiation remain separate batches. [Method-owned parameters](METHODS.md)
reuse the same metadata index and expose a canonical declaring method.
Metadata generic parameters report `isLoaded: false`; constructing
arrays/pointers/function pointers from them reports a TypeLoad diagnostic until
generic type services are available.
The independent SDK 10.0.201 / CoreCLR 10.0.5 fixture compares six definitions
and nine parameters against reflection and SRM constraint tokens. Regenerate
with `node packages/clr/tools/capture-generic-parameters.mjs
tests/fixtures/clr-generic-parameters`. All 16 focused type tests passed; the
seven directly affected tests also passed after moving unsupported-construction
checks to cache misses. The authored `#-` fixture exercises actual unsorted
physical rows, bypassing the fixture builder's canonical sorting.

`node packages/clr/tools/benchmark-generic-parameters.mjs` measured all fixture
parameter identities at cold median 33.583 µs / p95 88.125 µs, and cached token
lookup at median 0.0333 µs / p95 0.0530 µs. Node 24.21.0 on Apple M3 Pro,
darwin-arm64; shared machine, allocations unmeasured, no prior generic-parameter
implementation. The existing vector benchmark measured parent/head warm lookup
medians 0.0866/0.0847 µs and p95 0.0988/0.0914 µs; cold medians 12.417/12.250 µs
and p95 33.000/24.667 µs. These are regression controls, not speedup claims.
Evidence qualifies metadata identities on JavaScript; executable generic
behavior on source VM, direct CIL and Rust/Wasm remains outside this batch.

`context.types.load(module, token, {signal})` explicitly completes a TypeDef or
TypeRef's inheritance graph on that same canonical descriptor. `find(module,
fullName)` adds indexed exact-name lookup. Loaded descriptors expose `kind`,
`baseType`, transitive `interfaces`, enum `underlyingType` and `isLoaded`. Type
identity remains stable before/after loading and across explicit assembly sharing.

Hosts register BCL identities through `context.types.defineIntrinsic(fullName,
{kind, baseType, interfaces})` and retrieve them with `intrinsic(fullName)`.
The context's optional `typeOptions.resolveExternalType({module, assemblyName,
namespace, name, signal})` hook explicitly maps AssemblyRefs to loaded descriptors;
a null result falls back to assembly resolution. There is no automatic framework
facade binding. This host seam does not replace A04's managed framework registry.
Async host callbacks use `request.resolveType(module, token)` for dependent type
loads, preserving cycle ancestry across awaits. Direct recursive calls through
`context.types.load` start an independent operation and are unsupported inside
a resolver callback when they depend on the same unresolved type.

Inheritance/interface and TypeRef cycles produce TypeLoadException. Type loading
checks cancellation and configurable `maxDepth` (default 128, maximum 512) and
`maxMetadataRows` (default 100,000). Metadata definition identity retains its own
documented bounds. Relevant metadata rows are indexed in linear time; inherited
interface output is materialized once per completed definition. Concurrent first
loads may repeat work but publish the same descriptor.

Generic inheritance/constraints, exported-type forwarding,
multi-module TypeRefs, layout/dispatch/assignability and full verification remain
separate batches. Unsupported resolution forms produce explicit TypeLoad errors.
The independent native graph fixture covers ordinary C# base/interfaces, nested
ownership, structs, enums and circular metadata rejection. Regenerate with
`node packages/clr/tools/capture-type-graphs.mjs tests/fixtures/clr-type-graphs`.

`context.types.szArray(element)` and `array(element, rank)` canonicalize vectors
and multidimensional arrays separately, including the distinct rank-one `[*]`
form. Rank is 1–32. Arrays expose their System.Array base, registered base
interfaces, and vectors add five instantiated generic collection interfaces.
Their synthetic `Get`, `Set`, `Address` and `.ctor` descriptors expose return and
parameter types plus the declaring array. `resolveArrayMethod` matches an exact
signature; `types.resolveArrayMember(module, memberRefToken)` decodes array
TypeSpec/MemberRef metadata, including multidimensional lower-bound constructors.
Jagged vectors expose length constructors for each consecutive vector level.

`pointer(element)`, `byRef(element)` and `functionPointer(signature)` preserve
canonical structural identity. Function pointer signatures use TypeDesc return
and parameter types, convention/receiver flags, generic arity and vararg sentinel
(-1 when absent). Nested byrefs and void/TypedReference array elements fail explicitly. Type
construction is bounded by `maxConstructedTypes` (default 100,000) and 4,096 display
name characters. TypeSpecs preserve element/rank identity; bounds are constructor
arguments, not part of runtime array type identity.
Element constructions retain their element's defining module/context, including
when another context explicitly shares that element type.

Hosts explicitly register System.Array, primitive and generic collection types.
`defineIntrinsic` accepts `genericArity` for those host contracts; generic
parameters and array interface instantiations have canonical identities. General
metadata generic instantiation, constraints and modifiers remain unsupported with
TypeLoad diagnostics. These APIs describe types/members; they do not execute
array methods, allocate instances, perform assignability or generate layout.

The constructed-type oracle compares native .NET array interfaces and synthetic
method/constructor signatures. Regenerate with `node
packages/clr/tools/capture-constructed-types.mjs tests/fixtures/clr-constructed-types`.
The .NET 10.0.5 / SDK 10.0.201 capture covers five array shapes and an actual
C# multidimensional-array constructor MemberRef. Thirteen focused type tests
passed on Node 24.21.0. This qualifies the JavaScript metadata service; array
execution on source VM, direct CIL and Rust/Wasm is not part of this batch.

`node packages/clr/tools/benchmark-constructed-types.mjs` measured cold vector
descriptor construction at median 12.083 µs / p95 33.667 µs, and cached lookup at
median 0.0926 µs / p95 0.1092 µs on Apple M3 Pro, darwin-arm64, Node 24.21.0.
The machine is shared, allocations were not measured, and no equivalent previous
implementation exists. Construction materializes its interface and method
signatures once; cached identities avoid rebuilding them.

`context.types.isAssignableFrom(target, source, {signal})` compares loaded
TypeDesc identities without loading assemblies or executing an instance cast.
It handles non-generic class inheritance, interface closure, value-type boxing
to their declared bases, and array covariance/rank rules. Array elements use
unboxed conversion rules, including matching CLI signed/unsigned integral
categories and enum underlying types. Vectors also support the five registered
generic collection contracts with the CLR's array-specific element conversion.
This is separate from general generic variance.

Results are cached with weak type keys. An uncached decision walks the bounded
base/interface graph; GenericParam owners are indexed once per module to reject
unimplemented generic definitions explicitly. `maxDepth` and `maxMetadataRows`
apply, and cancellation is checked before cached results and during traversal.
Unloaded descriptors, general generic variance/Nullable rules and pointer/byref/
function-pointer casts report TypeLoad diagnostics. COM/type-equivalence and
dynamic interface behavior are outside this metadata-only service. Full
500-pair and executable cast qualification remains separate work under T03.7.
The independent SDK 10.0.201 / CoreCLR 10.0.5 capture checks 33 targeted pairs;
all 16 focused type tests passed on Node 24.21.0. Regenerate with
`node packages/clr/tools/capture-assignability.mjs tests/fixtures/clr-assignability`.
`node packages/clr/tools/benchmark-assignability.mjs` measured cold pair decisions
with loaded descriptors at median 0.7222 µs / p95 2.8043 µs, and cached interface
decisions at median 0.0746 µs / p95 0.0915 µs on Apple M3 Pro/darwin-arm64.
The machine is shared, allocations are unmeasured, and no previous equivalent
implementation exists. This evidence covers the JavaScript metadata service;
source VM, direct CIL and Rust/Wasm executable casts remain unqualified here.

`AssemblyLoadSession` owns a Default context and a registry of custom contexts.
No process-global assembly registry is used. `createContext` accepts a name,
collectibility flag, finite `AssemblyResolver`, optional asynchronous load
override and an assembly limit. Direct `new AssemblyLoadContext(session, options)`
also registers with that session.

`loadFromStream(bytes)` copies and parses one bounded PE image. It reads manifest
identity and MVID; it does not decode methods or load dependencies.
`loadFromAssemblyName(name, {requester, signal})` checks the context's existing
bindings, Load override, explicit resolver, Resolving handlers and session
AssemblyResolve handlers in that order. A resolver returns image bytes, an entry
containing bytes, an existing `RuntimeAssembly`, or null to continue. Missing and
mismatching references carry the requesting assembly in their diagnostics.

A context binds at most one version per simple name. An existing higher version
can satisfy a lower name request; loading a different version from bytes is a
conflict. Explicitly sharing an assembly across contexts preserves its original
type identity. A resolver cannot register an unrelated assembly while failing
the requested identity. Independent concurrent requests share a pending resolution.
Synchronous same-name callback reentry fails explicitly. Async callbacks must use
`request.resolveAssembly(name, options)` for dependent resolution: its explicit
ancestry detects cycles across `await` boundaries. A direct call through
`request.context.loadFromAssemblyName` after `await` has no ancestry and cannot be
distinguished from independent concurrency; using it to await the same pending
assembly is unsupported and may deadlock.

`RuntimeAssembly.manifestModule` exposes immutable row snapshots, heap values,
MVID, interned TypeDef identity handles and lazy method bodies. Method byte arrays
are copied on return; `methodBodyReadCount` reports actual PE body decodes.
TypeDef handles are loader identities; full TypeDesc construction is separate
work under T03. `reference(index)` only reads an AssemblyRef identity;
`resolveReference(index)` resolves on first use. `dependencies` records traversed
edges and offers an optional bounded full walk. Cyclic references do not recurse
during ordinary assembly load.

`unload()` is available only for collectible contexts. It raises Unloading once,
rejects new loads and root registrations, and removes the context from session
enumeration. Existing instances and type handles may continue reading their
assembly metadata until collected. The session holds collectible contexts weakly.
`context.roots.add(object, {kind, weak})` returns an idempotent release lease;
strong leases retain their context. `roots.enumerate()` is the explicit bridge
for a managed collector to visit roots; weak roots are opt-in. The JavaScript
WeakRef regression requires `node --expose-gc` and does not qualify A06/Rust GC.

`RuntimeAppDomain` exposes the current logical domain, loaded-assembly
enumeration, AssemblyLoad, AssemblyResolve and TypeResolve subscriptions.
`RuntimeAppContext` stores runtimeconfig-derived data and Boolean switches with
an explicit base directory. These are host APIs; managed framework registration
and executable AppDomain fixtures depend on the A04 framework-binding work.

Limits default to 1,024 contexts per session, 10,000 bindings/pending loads per
context, 65,536 explicit GC roots, 1,024 listeners per event and 64 MiB per image.
Image limits may be explicitly raised to 256 MiB. Cancellation is checked before
parsing and after asynchronous boundaries. Native unload fixtures and JS host
collection are qualified independently; unsupported runtime integrations remain
explicit.

The native context capture is
`node packages/clr/tools/capture-context-reference.mjs`, followed by
`node --expose-gc --test --test-concurrency=1 tests/clr-context-*.test.js`.
All nine focused tests passed with Node 24.21.0 on darwin-arm64. The independent
CoreCLR 10.0.5 capture (SDK 10.0.201) checks identities, MVIDs, references, type
isolation and collectible lifetime with two independently built Plugin versions.
This is metadata/lifetime evidence, not a claim of managed method execution by
SharpForge. The AppDomain facade is tested through the host API; registering its
managed framework members remains part of the framework-binding work.

Run `node packages/clr/examples/contexts.mjs` for the two-version example.
`node --expose-gc packages/clr/tools/benchmark-contexts.mjs` measures cold stream
loading, warm identity binding and cached method-body copying. These new services
have no previous loader implementation baseline.

Apple M3 Pro / darwin-arm64 / Node 24.21.0, 4,096-byte native fixture:

| Operation | Median µs | p95 µs | p99 µs |
| --- | ---: | ---: | ---: |
| Cold context and stream metadata load | 27.112 | 114.108 | 263.100 |
| Warm assembly identity binding | 0.256 | 0.608 | 1.097 |
| Cached method-body defensive copy | 0.272 | 0.478 | 0.833 |

The JSON benchmark records retained heap deltas after allowing WeakRef's
same-job keepalive to expire. Exact allocation counts are not measured, and
negative retained deltas can result from collection of earlier work.
