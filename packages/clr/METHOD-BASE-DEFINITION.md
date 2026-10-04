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
generic base instantiation, type generic variables,
TypeSpec/open-generic modifier definitions, function-pointer signature types, array sizes and nonzero
lower bounds require later services and fail with `SFCLR012` when traversal needs them.
Opaque host intrinsics have no method metadata: reaching one before locating a
slot introduction also fails, so an Object override cannot silently become its
own root. A complete metadata chain with no matching ancestor introduces the
reuse-slot method itself. This is not a full MethodDef validity or visibility pass.

Required and optional custom modifiers participate in signature identity at their
encoded position, including beneath supported array/pointer/byref constructors.
Modifier kind, order and canonical TypeDef/TypeRef identity must all match;
optional modifiers are not discarded during implicit slot matching. This follows
[CoreCLR's element comparison](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/siginfo.cpp#L3770)
as used by its virtual-slot signature comparison. Equivalent references across
modules resolve through the existing loader. This does not interpret modifier
semantics or implement type equivalence, generic modifier expressions or class
MethodImpl mappings. Modifier-bearing generic argument subtrees remain unsupported,
including beneath arrays and nested generic instances. A scalar context flag in
the existing recursive key walk preserves this limit without an extra tree walk
or per-node data allocation; existing generic argument restrictions are preserved.

Modifier matching extends the existing cached signature keys; it introduces no
persistent cache or descriptor fields. Signature depth/node limits apply before
binding; generic metadata row limits apply before querying a resolved modifier's
generic parameters, and modifier identities share the context's signature-identity
budget. Cancellation is checked after asynchronous binding and before publishing
a complete signature key.

The modifier increment passed 32/32 focused tests across eight files, with no
skips, and ten independently emitted matching native roots on SDK 10.0.201/CoreCLR 10.0.5.
Syntax/static checks passed 3,556/3,552 modules; manifests covered 961 Node and 37
browser files with no errors. Structure reported 271 existing findings, none in
changed files. One limiter ran all phases sequentially with concurrency 1 and a
1 GiB Node heap; the initial sequence had no failures or reruns. Review then added
five independent native mismatch chains for kind, identity, order, omission and
return/parameter placement. Each Child(A) skips a Middle(B,new-slot) and resolves
the Root(A) introduction, agreeing with the loader. That extension passed native
15 plus 8/8 tests in the two affected files. Product code and benchmarks did not
change; the initial measured ten-method capture is retained separately. Broader
platform qualification remains staged.

On the shared Apple M3 Pro/macOS 26.6/Node 24.21.0 host, existing 23-method cold
median/p95 moved 145.167/302.875 → 149.666/347.917 µs. The +45.042 µs (+14.871%)
p95 and +4.499 µs (+3.099%) median were explicitly accepted by the root integration
reviewer for correct bounded modifier matching. Cached median/p95 moved
124.084/162.917 → 124.375/164.500 ns, both within budget. The new ten-method fixture
measured cold median/p95 159.417/435.875 µs and cached 122.750/173.375 ns.
[All 600 raw samples, exact source heads, commands and import provenance](benchmarks/modified-method-overrides-node24.json)
are retained. The existing cached result path is unchanged. These measurements
establish no cause, noise, significance or general speedup claim; allocation
counts and peak memory were not measured. No repeat or retuning was requested.

Constrained generic methods now follow the same implicit class-slot walk. Each
matched override edge compares method GenericParam constraints separately from
signature identity, following [ECMA-335 II.9.9](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf)
and [CoreCLR constraint comparison](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/siginfo.cpp#L4630).
Reference-type, value-type and default-constructor requirements may be removed
but cannot be strengthened; a value-type requirement implies a constructor for
this comparison. Explicit TypeDef/TypeRef constraints compare by canonical type
identity, including equivalent references across assemblies. Object constraints
and ValueType constraints under the struct flag are vacuous. Different explicit
constraints fail instead of silently selecting another slot.

This is constraint compatibility for open method definitions, not generic type
instantiation or argument satisfaction. Bare open generic definitions, TypeSpec
constraint expressions, method
variance, allow-byref-like flags and contradictory special flags report SFCLR012.
Generic declaring/base types and class MethodImpl remain separate. The existing
GenericParam reader validates owner, position, arity and token extents. Context
row limits are checked before expanding generic descriptors; successful per-method
constraint snapshots use a lazy context-local weak cache. Unconstrained matches
allocate no constraint service or snapshots. Cancellation precedes cache access
and publication; a cancelled resolution can be retried. Per-edge comparison is
linear in explicit constraint count using canonical identity sets, after bounded
metadata/type loading. No method body is inspected.

SDK 10.0.201/CoreCLR 10.0.5 captured 12 C# method roots and three independently
persisted IL cases: weakened class/new constraints and constructor implication
were accepted; the stronger class requirement raised TypeLoadException. All
32 affected tests pass with zero skips, including mandatory source/image hashes.
Syntax/static checks pass (3,448/3,444 modules), manifests pass, and structure
reports 271 existing findings, none in changed files. All local jobs ran serially
under one limiter with concurrency 1 and a 1 GiB heap cap.

Exact-parent control (`66599db4` → `996b0059`) over 23 methods measured cold median
154.833 → 154.917 µs (+0.084 µs), p95 310.875 → 350.750 µs (+39.875 µs/+12.827%).
Cached median was 133.625 → 120.250 ns, p95 185.041 → 169.959 ns. The root
integration reviewer explicitly accepts the measured cold p95 cost for bounded
per-edge constraint compatibility. Unconstrained matches allocate no constraint
service or promise. No repeat or retuning was required.

The new 12-method fixture measured cold median 145.542 µs / p95 317.667 µs and
cached median 141.833 ns / p95 169.333 ns. [All 600 raw samples, p99, exact heads,
commands and provenance](benchmarks/constrained-method-overrides-node24.json)
are retained. Controls import their own CLR implementation; only byte-identical
CIL/archive dependencies are shared. Runs used shared Apple M3 Pro/darwin-arm64,
Node 24.21.0. No causal, noise, significance, speed or peak-memory attribution is
made; allocations and cache footprint are unmeasured.

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

Generic-signature qualification captured 13 independent C# records on SDK
10.0.201/CoreCLR 10.0.5. All 24 focused generic/base/interface tests passed without
skips; the final mandatory oracle also passed after adding source/image hash
assertions and removing its draft skip. Syntax/static checks passed (3,355/3,351
modules); structure reported 271 existing findings, none in changed files.
Capture reuses `capture-method-base-definition.mjs` with the explicit
`tests/fixtures/clr-method-base-generic/Program.cs` source. Its source and image
hashes are retained; executable fixture bytes were unchanged when recording those
hashes. The benchmark accepts that fixture's `native-method-bases.json` path.

The exact-parent control (`605ecb90` → `6a12868c`) measured cold 23-method median
153.541 → 153.459 µs and p95 363.333 → 320.959 µs. Cached median was
0.135625 → 0.123625 µs, p95 0.182875 → 0.185625 µs (+1.504%, +2.750 ns).
The new 13-method fixture measured cold median 179.417 µs / p95 349.750 µs and
cached median 0.122750 µs / p95 0.179292 µs. All 600 raw samples, p99, commands,
exact sources and fixture hashes are in [benchmark evidence](benchmarks/generic-overrides-node24.json).
Runs were serial on shared Apple M3 Pro/darwin-arm64, Node 24.21.0, with a 1 GiB
heap cap. No speed, causal or statistical significance claim is made; allocations
and cache footprint were not measured. The detached control imported its CLR
implementation through direct relative paths; its node_modules link shared only
byte-identical transitive CIL/archive trees, verified by Git tree IDs.

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
