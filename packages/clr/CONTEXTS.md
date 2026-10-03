# Assembly contexts and metadata lifetimes

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
the requested identity. Same-name reentry during a user resolving callback fails
explicitly; hosts should serialize such requests while their callback is pending.

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
