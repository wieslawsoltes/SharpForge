# Canonical generic type instantiation

`await context.types.instantiate(definition, typeArguments, options)` constructs
an open, partially open or closed `TypeDesc` from an existing generic definition
and ordered `TypeDesc` argument handles. It completes the requested type's base
and interface graph without reading method bodies or executing managed code.
This is the host JavaScript metadata service for SF-A04-T05.1 (#2460).

```js
const module = assembly.manifestModule;
const box = module.typeDefinition(boxTypeDefToken);
const integer = context.types.intrinsic('System.Int32');
const closed = await context.types.instantiate(box, [integer], { signal });

closed.genericDefinition === box; // true
closed.genericArguments[0] === integer; // true
closed.containsGenericParameters; // false
closed.isLoaded; // true: the requested inheritance graph is complete
```

Framework binding remains an explicit host policy. A matching type name does
not satisfy an AssemblyRef. `defineIntrinsic` is available for deliberate host
registrations, including generic definitions with `genericArity`; registration
is not evidence that a framework assembly or its executable implementation has
been loaded. Existing vector interfaces use this same generic cache.

## Identity and ownership

The canonical tuple consists of the definition handle and the ordered argument
handles. Neither a metadata token on its own nor a formatted name identifies a
construction. Two referring assemblies resolving the same definition and
arguments obtain the same live handle. Loading a definition again in another
context gives a different definition handle and therefore a different tuple.
Arguments from other contexts retain their original module, owner and identity.

The definition's type service owns the tuple. Calling another context's
`types.instantiate` delegates to that owner, including its configured graph and
work bounds. A construction's `module`, `assembly`
and `metadataToken` describe its generic definition; `loadContext` is the
definition's context. `isCollectible` also accounts for every argument, including
collectible types nested in arrays, pointers or function-pointer signatures.
Consequently the defining assembly alone does not describe all of a
construction's lifetime dependencies.

| Descriptor | Generic declaration or argument information |
| --- | --- |
| Generic definition | `genericParameters` contains its canonical formal handles; `genericDefinition` is null |
| Constructed type | `genericDefinition` identifies the definition; `genericArguments` is a frozen ordered array |
| Constructed type's `genericParameters` | Empty; the shared TypeDef token does not turn it back into a definition |
| Generic parameter | `genericParameterOwner`, position, attributes and constraint tokens retain their original declaration |
| Array, pointer, byref or function pointer | `containsGenericParameters` follows the element or signature handles |

Passing the definition's own formal parameters in their original order
normalizes to the definition itself. Passing a different owner's parameters
produces an open construction, even if those parameters have identical names
and positions. A mixture of formal handles and ordinary types is partially
open. Replacements are simultaneous: a parameter occurring inside a supplied
argument belongs to the caller and is not substituted again.

Arity comes from the actual GenericParam rows. A nested type's backtick suffix
and its declaring type's arity are not used to invent extra parameters. C#
normally includes enclosing parameters first in a nested declaration's rows;
CLI metadata can express nested declarations without that propagation. The
native fixture covers both forms. See the native
[MakeGenericType contract](https://learn.microsoft.com/en-us/dotnet/api/system.type.makegenerictype?view=net-10.0)
for its open-construction and nested-arity rules.

`fullName` retains SharpForge's existing diagnostic spelling, for example
``Fixture.Pair`2[System.Int32,T]``. It is not `System.Type.FullName` or an
assembly-qualified reflection name. Native reflection has distinct null and
qualification rules for generic names, documented in
[Type.FullName](https://learn.microsoft.com/en-us/dotnet/api/system.type.fullname?view=net-10.0).
Names never establish equality. Full generic reflection naming remains #2477.

## Scoped TypeSpec resolution

`types.load` accepts explicit type and method environments for TypeSpec tokens:

```js
const resolved = await context.types.load(module, pairTypeSpecToken, {
  typeArguments: [integer],
  methodArguments: [context.types.intrinsic('System.String')],
  signal,
});
// A signature Pair<!0,!!0> now refers to these two exact handles.
```

Each array is copied by bounded numeric indexing before an asynchronous bind.
Caller iterators are not invoked; subsequent array mutation cannot alter the
operation. An absent scope remains absent, rather than borrowing parameters
from a neighboring TypeDef or MethodDef. A referenced VAR/MVAR slot without a
matching supplied handle fails with `SFCLR012`. Explicit null arrays are
invalid; omit an unused scope. Native `Module.ResolveType` accepts null for an
unused scope, so reference replay translates that native representation to an
omitted JavaScript option. The native API's context requirement is described in
[Module.ResolveType](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.module.resolvetype?view=net-10.0).

The loader caches only validated, unbound TypeSpec syntax by module/token.
Resolved results are never stored in a module/token-only cache. A traversal's
cycle markers include both ordered environments, preserving distinctions
between type and method parameters, foreign owners, and swapped arguments.
Every final construction still reaches the shared canonical tuple cache.

Definition inheritance resolves with that definition's own formal parameters;
a caller's TypeSpec environment is not applied to unrelated metadata. Handle
substitution then maps the completed definition graph to the requested tuple.
The public AST substitution functions in [GENERICS.md](GENERICS.md) remain useful
for metadata emission. They retain their same-token-scope contract and are not
used to reinterpret a foreign argument's token inside the referring module.

## Graph completion and unsupported semantics

`baseType` and `interfaces` contain canonical substituted handles. Interface
diamonds deduplicate by identity. Completion detects real inheritance and
TypeSpec cycles, while arguments such as `Node<T> : Box<Node<T>>` remain finite.
An argument's identity can be present before its own inheritance graph has
been requested. Calling `instantiate` for that argument completes the same
handle later; loading every argument's inheritance recursively would expand
legal self-referential metadata without bound.

`isLoaded` means the requested base/interface graph completed. It does not
certify every CLR semantic rule or executable member. In this batch:

- Target definitions with special generic constraints or GenericParamConstraint
  rows reject with `SFCLR013`, including otherwise valid native constructions.
  Constraint enforcement and recursive constraint graphs remain #2463.
- Variance attributes are retained; declaration variance validation and variant
  assignability remain #2464. Existing unsupported cast paths keep their
  diagnostics instead of treating a loaded tuple as a successful cast.
- Generic MethodSpec binding, instantiated members, virtual dispatch and shared
  generic execution remain #2462; dictionaries and static storage remain #2465.
- Modified-type reflection and complete function-pointer reflection remain
  #702. Signature decoding and the existing function-pointer descriptor factory
  are reusable independently of those reflection surfaces.
- Full generic reflection remains #2477. This API does not add managed
  `System.Type.MakeGenericType` execution or a general engine token resolver.

Malformed parameter flag combinations, wrong arity, non-definition receivers,
direct pointer/byref/function-pointer arguments and invalid void-like intrinsic
arguments fail explicitly. TypeSpec class/value tags are checked against the
canonical definition category. A host's intrinsic registration supplies its
already loaded base/interface graph; this service does not infer framework
generic inheritance templates that the host has not registered.

## Cancellation, unloading and cache lifetime

Generic dependency binds belong to the assembly context. A resource or generic
consumer's AbortSignal is not installed on that shared bind. Each generic
consumer waits independently and rejects promptly on abort; listeners are
removed after success, failure or cancellation, and late provider failures
remain observed. Generic `resolveExternalType` waits use the same helper even
when a callback ignores cancellation; that callback retains its existing
caller signal argument. Its late result cannot publish through the completed
generic operation. Ordinary load-context and non-generic TypeLoader cancellation
behavior is unchanged. The shared CLR helper is `binding-wait.js`; satellite
integration must delegate its earlier resource wait helper to this helper.

A lazy monitor shares one unloading subscription across concurrent operations
in each collectible context. Each operation unregisters in `finally`. Visits
check a scalar invalidation flag, avoiding a repeated scan of every argument
context. Copied root VAR/MVAR argument handles are observed before resolving an
external generic definition, so their contexts cannot unload unnoticed while
that definition is binding. Noncollectible contexts need no unloading
subscription. A context's monitor bounds simultaneous generic observers by its `maxGenericWork` setting;
this is a separate allowance from each operation's visited-work budget.

One shared completion seam checks all participating monitors before returning a
successful root operation and immediately before publishing its requested
descriptor's loaded state. This bounded check also catches unloading when an
earlier user event listener throws before the monitor receives notification.
Its cost is linear in the number of participating collectible contexts, at the
root boundaries; the per-node lifetime guard remains constant time.

Before publishing a graph, resolution checks cancellation and observed context
unload transitions. The operation tracks the defining context and transitive
argument contexts, including foreign collectible ones. A bind may complete
after one consumer cancels, but that cancelled consumer cannot publish a graph.
Another independently active consumer may complete the same canonical handle.
A failed or cancelled completion is retryable; failures are not cached as
successful graph results. Metadata dependencies already completed during the
traversal, or completed by another retained-metadata operation, keep their
canonical state. A failing operation does not roll back another operation's
work or claim exclusive ownership of shared descriptors.

Retained metadata handles remain usable after unloading has already begun,
consistent with the existing context contract. New assembly admission or
dependency binding still requires an active context. An unload transition
during the current generic operation rejects with `SFCLR008`; it cannot turn a
pending result into a successfully published graph. Native unloading is also
cooperative, as described by the
[assembly unloadability guide](https://learn.microsoft.com/en-us/dotnet/standard/assembly/unloadability).

Noncollectible tuples keep the existing strong canonical cache. Any construction
that refers to a collectible context is held through a WeakRef. Cache keys
contain weakly assigned numeric handle identities, without a parallel strong
descriptor registry. Derived depth facts and definition facts use WeakMaps.
A retained constructed handle owns its arguments and their contexts; dropping
all such roots permits collection while a shared definition remains alive.
This transitive property corresponds to the scope of
[MemberInfo.IsCollectible](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.memberinfo.iscollectible?view=net-10.0).

The cache uses lifetime high-water limits. Collected weak values do not reset
the count of admitted tuple keys or assigned identity IDs. A collected value
can be recreated for its existing key while its component handles remain live;
this does not allocate another key slot. Warm live handles retain identity even
after a limit has been reached.

## Bounds and diagnostics

Options are configured through the existing context `typeOptions` object.

| Bound | Default | Accepted limit |
| --- | ---: | --- |
| `maxDepth` | 128 | 1–512; graph ancestry and construction shape depth |
| `maxMetadataRows` | 100,000 | 1–1,000,000; existing TypeDef/InterfaceImpl graph index |
| `maxConstructedTypes` | 100,000 | 1–1,000,000; tuple entries and handle IDs, separately |
| `maxGenericWork` | 100,000 | 1–1,000,000; shape, traversal and context-observer allowances, separately |
| `maxTypeSignatureBytes` | 65,536 | 1–1,048,576; each TypeSpec blob before decoding |
| Explicit argument arrays and definition arity | 1,024 | Fixed maximum per scope |
| Constructed diagnostic name | 4,096 characters | Fixed maximum |

The canonical GenericParam reader separately bounds GenericParam plus
GenericParamConstraint rows to 100,000. CIL signature decoding retains its own
64-level/4,096-node defaults. Context binding, metadata heaps and constructed
element types retain their pre-existing independent limits. The generic work
counter includes repeated visits and context-lifetime checks; shape preflight
has its own allowance before a cache entry is admitted. Each root completion
check scans at most the context monitors already admitted by those visits; it
does not reset or expand the operation's work allowance. No counter claims to
measure all assembly-provider or metadata-reader work.

| Diagnostic | Meaning in this service |
| --- | --- |
| `SFCLR005` | Malformed metadata, heap/signature decoding failure or an unclassified provider failure |
| `SFCLR006` | Invalid new generic work or signature-byte configuration |
| `SFCLR007` | Exhausted shape, traversal, byte, name, entry or identity bound |
| `SFCLR008` | An observed context began unloading during resolution |
| `SFCLR009` | The consumer was cancelled |
| `SFCLR012` | Invalid generic definition, arguments, environment, category or type cycle |
| `SFCLR013` | Explicit unsupported generic constraint semantics |

Existing assembly resolution diagnostics propagate unchanged. Native reflection
often uses argument exceptions where this metadata loader uses `SFCLR012`; the
reference corpus records both contracts without asserting exception-type parity.

Warm instantiation costs are linear in argument arity for the input copy,
validation and tuple key. Cold work is bounded by the distinct construction
shapes visited, metadata indexes, substituted inheritance/interface edges and
output, with memoized immutable shape depths and per-substitution identities.
TypeSpec decoding occurs once per admitted module/token; binding and scope
resolution remain explicit on each call. No graph expansion is performed for
an argument merely because that argument has an inheritance graph.

## Reference and performance qualification

The independent C#/SRM observer is in `interop/GenericInstantiation/`. Its
offline capture tool pins SDK 10.0.201 and CoreCLR 10.0.5, records compiler and
source hashes, and retains real fixture images and raw TypeSpec signatures in
`tests/fixtures/clr-generic-instantiation/`. Strict replay requires the capture;
an absent fixture is a failure, never an availability skip.

```sh
SHARPFORGE_ORACLE_DOTNET=/absolute/dotnet-10.0.201/dotnet \
  node scripts/limited.js node packages/clr/tools/capture-generic-instantiation.mjs \
  --output tests/fixtures/clr-generic-instantiation
node scripts/limited.js node --test tests/clr-generics-instantiation*.test.js
```

The focused tests include hostile metadata, exact owner/context distinctions,
caller-array snapshots, cancellation, failed binds, disposal, cache limits and
graph recursion. A separate isolated Node process always runs with `--expose-gc`
to check retained and released collectible constructions through every supported
wrapper. Its bounded GC probe is host-specific evidence, not a promise that
collection occurs after a fixed number of cycles on every engine.

Replay distinguishes fixture type-graph parity from deliberately registered
intrinsic identities/shapes. CoreLib assembly membership and its complete
interface graphs are retained as native provenance, not inferred from host
registrations. Function-pointer results compare return/parameter shapes and raw
signature headers; their full reflection flags and named calling conventions
remain #702. A root byref TypeSpec is rejected by the canonical CIL signature
context check even when SRM decodes its bytes. Explicit class/value integrity
checks also remain enforced independently of native decoder permissiveness.
Every such comparison category is reported by the replay test; none is counted
as unrestricted CLR reflection parity.

`benchmark-generic-instantiation.mjs` uses an unchanged driver for before/after
controls against public main `df5bbff9c9affa45808e9f737ef4751b55c9337a`. Controls
cover warm token/name/vector/function-pointer paths, ordinary cold graph loads,
and cold constructed wrappers. The new-service mode records closed, partial,
scoped, collectible and graph-completion costs separately. One TypeSpec case
uses arguments from two collectible contexts and includes monitor registration,
bounded root checks and deterministic cleanup. Each operation has
10 warmup batches followed by 100 chronological measured batches; median and
nearest-rank p95 use those fixed samples. Validation occurs after each timed
batch and checks canonical handles, not a discarded result.

```sh
node scripts/limited.js node packages/clr/tools/benchmark-generic-instantiation.mjs \
  controls artifacts/generic-before.json /absolute/baseline/packages/clr/src/index.js
node scripts/limited.js node packages/clr/tools/benchmark-generic-instantiation.mjs \
  controls artifacts/generic-after.json
node scripts/limited.js node packages/clr/tools/benchmark-generic-instantiation.mjs \
  service artifacts/generic-service.json
```

The report retains product tree/content hashes, driver/input hashes, host details,
raw samples, correctness-guard counts and explicit measurement boundaries.
Inputs and product sources must be committed and clean. Exact allocations and
concurrent host activity are not measured. The new service has no previous
equivalent implementation; performance thresholds apply to the existing controls.

Native capture, the focused Node gate and benchmarks are pending the scheduled
validation slot. No passing result or speedup is claimed here. Source VM,
direct CIL, Rust native/Wasm and browser execution qualification remain separate.
