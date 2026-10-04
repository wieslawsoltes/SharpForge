# Class method base definitions

`await method.getBaseDefinition({signal})` (or
`context.types.getBaseDefinition(method, {signal})`) returns the canonical
MethodDesc that introduced its implicit class virtual slot. A reuse-slot method
matches the nearest ancestor with the same name and signature; a new-slot method
starts a separate chain. Static, nonvirtual and interface methods return themselves.
This implements [ECMA-335 II.10.3.1](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf)
for implicit class overrides, rather than relying on name alone or returning the
nearest override. Results retain the base method's declaring type and module.

The service reuses canonical type graphs, method ownership lists, signature ASTs
and generic-parameter metadata. Matching uses canonical resolved type identities
across modules, including primitive versus equivalent class/value encodings;
byref, pointer, vector and multidimensional array shapes are structural. Omitted
and explicitly zero array lower bounds represent the same default shape.
Unconstrained method generic parameters compare by position and arity. Return
types participate in matching. A closer nonvirtual match or final virtual match
is rejected. Static methods cannot match instance signatures. Type graphs and
signatures remain lazy; no executable body is read.

This is an explicit partial GetBaseDefinition contract. Class/covariant MethodImpl
slot mappings, strict access checks,
generic base instantiation, constrained generic methods, type generic variables,
modifier/function-pointer signature types, array sizes and nonzero
lower bounds require later services and fail with `SFCLR012` when traversal needs them.
Opaque host intrinsics have no method metadata: reaching one before locating a
slot introduction also fails, so an Object override cannot silently become its
own root. A complete metadata chain with no matching ancestor introduces the
reuse-slot method itself. This is not a full MethodDef validity or visibility pass.

Generic-instance signature types now match by canonical open definition identity
and recursively compared argument keys. This supports ordinary overrides whose
return/parameter types include `Box<int>`, nested instantiations, arrays and method
generic variables. TypeDef and TypeRef spellings of one definition share identity;
same-named types from separate assemblies or different argument lists do not.
No constructed TypeDesc or executable generic type is created. Definition arity
and class/value category must match. Constrained/variant definitions, unsafe
generic arguments and TypeSpec definition indirection reject with `SFCLR012`;
generic declaring/base classes and type-variable substitution remain unsupported.
The existing GenericParam service supplies ownership and constraints. A lazy
per-context weak cache retains successful definition arities; each uncached
definition preflights GenericParam/constraint row counts against the context
budget. Cancellation precedes publishing definition/signature/root caches.
Signature decoding supplies the existing depth/node bounds. No new definition
cache is allocated on paths without generic-instance signatures.

Generic-signature authored tests and an independent C# fixture are committed;
native capture, affected tests, control/new-capability measurements and checks
await the serial validation slot. No native/performance claim for this increment
is made yet. Capture reuses `capture-method-base-definition.mjs` with the explicit
`tests/fixtures/clr-method-base-generic/Program.cs` source; the existing benchmark
accepts that fixture's `native-method-bases.json` path as its optional argument.

Interface-only MethodImpl rows are now isolated from class virtual slots. The
service validates owner/token extents, local MethodDef body ownership and duplicate
declaration tokens. MethodDef declarations use canonical declaring types;
MemberRef declarations resolve TypeDef/TypeRef parents through the existing type
loader and reject field signatures. This permits ordinary class overrides through
a base type that also explicitly implements local or external interfaces, and
explicit interface bodies retain their own class slot root. CoreCLR stores these
interface mappings separately in its dispatch map ([WriteMethodImplData](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/methodtablebuilder.cpp)).

This classification does not resolve the interface declaration method by name,
certify body/declaration signature compatibility or build interface dispatch maps.
MemberRef bodies and TypeSpec/ModuleRef/MethodDef declaration parents remain
explicitly unsupported. Class declarations still fail even when mixed with valid
interface rows. Each uncached mapped type scans its own rows once; completed
classification is cached per context. Before constructing body MethodDescs, the
combined TypeDef/MethodPtr/MethodDef count must fit the context row budget.
MemberRef signatures have a pre-copy 4 KiB limit, 128 KiB combined per type,
32 levels and 4,096 AST nodes. Aborted classifications publish no success cache.

Per-context weak caches hold completed roots, name indexes and signature keys;
immutable modules make invalidation unnecessary. Context type limits bound
hierarchy depth, per-module MethodDef/MethodImpl rows, visited same-name candidates
and distinct signature type identities. Module row limits are checked before new
method list/index allocation; existing method metadata has its own limits too.
Each uncached query visits ancestors and same-name candidates once, with signature
keys reused across queries. Malformed/ambiguous metadata uses `SFCLR005`, bounds
`SFCLR007`, and cancellation `SFCLR009`. Cancellation is checked before cache hits
and around asynchronous loading; cancelled operations publish no root result.
Cached roots remain usable through cooperative unloading, while new assembly loads
still follow the context's disposal rules.

Authored cases cover new-slot boundaries, overloads, skipped ancestors, canonical
cross-assembly identity, lazy identity paths, unsupported mappings, final/nonvirtual
collisions, complete metadata roots, limits, cancellation and unload. The independent
C# fixture compares actual CoreCLR roots for ordinary, overloaded, generic,
array/ref, abstract and sealed overrides. SDK 10.0.201/CoreCLR 10.0.5 captured 23
records. The initial focused run passed 35/36 and exposed C# multidimensional
arrays encoding default zero lower bounds. After accepting those default bounds
and adding an authored regression, all 8 base-definition tests pass; the 29 other
Method/graph regressions passed initially. The unchanged native capture was
reused. The [first failing run](benchmarks/method-base-first-focused.txt) is retained.
Node 24.21.0 syntax/static checks pass (3,089/3,085 modules); structure reports 268
existing findings, none in changed files. All local jobs ran serially.

On shared Apple M3 Pro/darwin-arm64, cold queries over 23 fixture methods measured
median 144.208 µs / p95 412.625 µs; cached asynchronous root lookup measured
0.120584 µs / p95 0.151958 µs. All 200 raw samples and exact source/fixture hashes
are retained in [benchmark evidence](benchmarks/method-base-definition-node24.json).
There is no prior equivalent API, allocation total or general speed claim.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-base-definition.mjs tests/fixtures/clr-method-base-definition
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-*.test.js tests/clr-types-graphs.test.js
node scripts/limited.js node packages/clr/tools/benchmark-method-base-definition.mjs
```

Invocation, vtable execution, full reflected-member views and source VM/direct
CIL/Rust native/Wasm execution qualification remain separate. #2475 stays open.


Interface-only MethodImpl qualification: SDK 10.0.201/CoreCLR 10.0.5 captured six
independent method records; all 16 focused interface/base-definition tests pass
without skips. The shared coded-index RID correction is merged; a malformed
MemberRef signature regression rejects oversized type RIDs before local aliases.
Syntax/static checks pass (3,259/3,255 modules); structure reports 269 existing
findings, none in changed files. Native capture, tests, benchmarks and checks ran
serially under one limiter with concurrency 1 and a 1 GiB Node heap cap.

On shared Apple M3 Pro/darwin-arm64 with Node 24.21.0, existing-path parent/head
cold median was 141.542 → 143.583 µs (+1.442%) and p95 324.916 → 327.042 µs
(+0.654%). Cached median was 0.121750 → 0.116292 µs and p95 0.164750 → 0.152333 µs.
The new six-method fixture measured cold median 79.458 µs / p95 203.083 µs and
cached median 0.125583 µs / p95 0.159416 µs. All 600 raw samples, p99 values,
exact sources, fixture hashes and commands are retained in
[benchmark evidence](benchmarks/method-interface-impl-node24.json). This single
shared-host pair establishes no causality, statistical significance or general
speed claim; allocations and added cache footprint are unmeasured.

```sh
node scripts/limited.js node packages/clr/tools/capture-method-base-definition.mjs tests/fixtures/clr-method-interface-impl tests/fixtures/clr-method-interface-impl/Program.cs
node scripts/limited.js node --test --test-concurrency=1 tests/clr-methods-interface-impl*.test.js tests/clr-methods-base*.test.js
node scripts/limited.js node packages/clr/tools/benchmark-method-base-definition.mjs
node scripts/limited.js node packages/clr/tools/benchmark-method-interface-impl.mjs
```
