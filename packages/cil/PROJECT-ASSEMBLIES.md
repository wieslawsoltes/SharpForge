# Closed project assemblies

`loadProjectAssembly(assembly, {dependencies, signal, assemblyLimits})` admits an
explicit set of canonical SharpForge PE artifacts and returns
`{image, modules, entryKey}`. `dependencies` is an array of
`{assembly: Uint8Array, project?, contextId?}` records. Byte arrays and ArrayBuffers
are also accepted. The loader never searches a path, opens a file or accesses a
network. A library may be the entry module; its linked image remains a library
with a null entry point.

Each module has its full `identity`, canonical display `key`, lowercase `sha256`,
an owned `bytes` snapshot, original unlinked canonical `image`, reusable
`AssemblyInspector`, dependency keys and optional project/context provenance.
`module.references.types`, `.methods` and `.fields` contain
`{token, targetKey, targetToken}` records. The local token is an actual TypeRef or
MemberRef. The target is an actual definition whose declaring type, name and
signature have been checked. Modules are ordered with dependencies before their
consumers.

Module `resources` are metadata descriptors pointing into the retained PE, and
`assemblyAttributes` preserve the canonical project attribute profile. The linked
image's `assemblies` records retain this identity and resource provenance without
copying payload bytes into the source instruction image. Resource payloads remain
available through each original inspector; loading metadata does not imply a new
runtime framework implementation of resource APIs.

The returned `image` is an independent source execution view. Types retain
`assemblyKey` and `metadataName` alongside their qualified `name`. Consumers must
use those structured fields and exact descriptor lookup; assembly display names
may contain bracket characters. Source records, methods and sequence points keep
their URI when it is unique. Collisions use a deterministic `sharpforge-assembly`
URI and retain `originalUri` plus `assemblyKey`. Each module's `sourceUris` Map
exposes the common mapping used by both runtime views. Source records, sequence
points and method source ranges also retain supplied `project` and `contextId`
provenance. Method, static, type, constant
and sequence-point indexes are remapped. No unresolved external descriptor or
external opcode remains in the linked image. The original module images and
caller-owned bytes are unchanged.

The linked image's `il.methodTokens`, `il.offsets` and `il.methodAssemblyKeys`
arrays are indexed by linked source method ID. Physical method tokens and CIL
offsets remain local to the original PE, so a token must be interpreted with its
assembly key. Synthetic execution adapters have a null physical token and an
empty offset array. They never claim a fabricated location in an emitted PE.

The emitted application PE retains its own definitions. Real AssemblyRef,
TypeRef and MemberRef rows represent references to other project PEs; dependency
methods are never copied into the application output. `loadAssembly(bytes)`
continues to load one canonical, **unlinked** module, including its
`externalReferences` metadata. This supports compiler admission of an intermediate
library without requiring all its runtime dependencies at compile time.

The additive emission option `memberDefinitions` preserves source member
accessibility and readonly fields as real MethodDef and Field metadata flags.
Its version 1 shape is `{version:1, methods:[{id,access}],
fields:[{type,index,access,isReadOnly}], statics:[{index,access,isReadOnly}]}`.
Every image method and field slot must have one record; identifiers are image
indices. Access is `public`, `internal`, `private`, `protected`,
`protectedInternal` or `privateProtected`. Each table is bounded at 100000
records. Explicit constructor wrappers use their source constructor's access.
The profile is non-executable metadata checked by canonical re-emission.
Omitting this option retains compatibility with earlier emitted artifacts.

The source execution view uses local adapters for constructors, static fields
and calls requiring precise library initialization. Constructors allocate one
object, execute the canonical instance initializer and constructor body, and
return the object. Producers may contain an explicit initialization helper or
an actual library `.cctor` body. Helper-based producers retain their existing
guard; real `.cctor` bodies receive a per-session guard that preserves recursive
default-value reads, runs once and caches a failed initializer without repeating
its effects. Both local and external references use those guards. The source
view currently rethrows the original cached fault; direct CIL uses its existing
`TypeInitializationException` wrapper. This is not a claim of identical exception
objects across the two engines.

New emitted PEs give the helper-based form a genuine CLI `.cctor`, so native
field access triggers initialization. `projectStaticInitializers:false` retains the previous emitted
scaffolding when reproducing an older canonical artifact; its absence in an old
debug profile selects that compatibility behavior during canonical verification.

## Admission and limits

Admission requires a complete supplied dependency closure, canonical CIL in every
supplied PE, matching full assembly identity and SHA-256, and matching definition
tokens and signatures. Actual TypeDef and member visibility, friend assembly
attributes and readonly field restrictions are checked before execution; forging
an otherwise canonical caller descriptor cannot grant additional access.
Duplicate identical artifacts coalesce. Different bytes
with the same full identity are rejected, including two target-framework outputs
that retain the same assembly name/version/culture/key. Producing separate
assembly identities is necessary to load those outputs in one execution scope.

The closed runtime profile currently admits unsigned, non-retargetable ordinary
assemblies. Compiler lowering supports closed nongeneric class references,
nonvirtual methods, constructors, properties and ordinary fields. Arbitrary .NET
assemblies, native implementations, generic/virtual external dispatch,
by-reference external signatures and netmodule execution retain explicit
boundaries. Canonical identity/reference emission remains separately available
for metadata inspection outside this runtime subset.

Limits are shared with the bytecode reference contract: 512 assemblies, 32 MiB
per PE, 64 MiB aggregate input, 8192 linked types, 65536 linked methods including
adapters, and 65536 static fields. Constants, sequence points and total linked
instructions are each bounded at one million. Reference metadata is bounded by
the shared `verifyProjectReferences` contract. Supplied artifacts are snapshotted
before decoding. Traversal is deterministic and cancellation is checked between
module and method phases. Loading belongs in a worker for larger graphs.

| Code | Failure |
| --- | --- |
| PRJ0001 | Invalid or unsupported canonical project profile |
| PRJ0002 | A required assembly was not supplied |
| PRJ0003 | Assembly identity or content hash differs |
| PRJ0004 | Conflicting bytes have the same assembly identity |
| PRJ0005 | Definition, signature or linked instruction verification fails |
| PRJ0006 | Graph, input or linked-image budget/cycle failure |
| PRJ0007 | Caller cancellation |

The public loader throws `CilError` with the listed `code`. The graph result is
intended for a runtime in the loading worker; its inspector objects are not a
structured-clone transfer format. The linked `image` retains the ordinary
structured-cloneable image contract.
