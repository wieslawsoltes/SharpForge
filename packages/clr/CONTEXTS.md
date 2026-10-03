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
decoded by identity lookup. Constructed types, layout and dispatch remain later
batches.

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

Inheritance/interface and TypeRef cycles produce TypeLoadException. Type loading
checks cancellation and configurable `maxDepth` (default 128, maximum 512) and
`maxMetadataRows` (default 100,000). Metadata definition identity retains its own
documented bounds. Relevant metadata rows are indexed in linear time; inherited
interface output is materialized once per completed definition. Concurrent first
loads may repeat work but publish the same descriptor.

TypeSpec/constructed inheritance, generic constraints, exported-type forwarding,
multi-module TypeRefs, layout/dispatch/assignability and full verification remain
separate batches. Unsupported resolution forms produce explicit TypeLoad errors.
The independent native graph fixture covers ordinary C# base/interfaces, nested
ownership, structs, enums and circular metadata rejection. Regenerate with
`node packages/clr/tools/capture-type-graphs.mjs tests/fixtures/clr-type-graphs`.

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
