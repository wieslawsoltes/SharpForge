# Source generic boxing and logical type identities

Closed source generic classes and structs retain their physical monomorphized
owners, such as `Sample.Cell{int}`. Storage, managed addresses, layout, casts,
method bodies, interface dispatch and snapshot type keys continue to use those
owners. The compiler also records an immutable logical identity containing the
CLR definition name and closed type arguments. Object formatting and runtime
Type names use that identity, for example ``Sample.Cell`1[System.Int32]`` and
``Cell`1``, respectively. Object overrides are reachable when their closed owner
is constructed, including when a BCL callback first reaches the override through
a box.

The source image's optional `sourceIdentity` property is additive. A named type
is `{name, assembly, arguments}`, where `assembly` is `source` or `core` and
`arguments` is a recursively closed array. Array arguments use
`{element, rank, vector}`. Nested names use CLR `+` separators and carry the outer
and inner type arguments in declaration order. These descriptors change display
and reflection projection only; they cannot replace a runtime MethodTable or
redirect a call.

The bytecode package exports `copySourceTypeIdentity(value)`, which returns an
owned, recursively frozen descriptor or throws `TypeError`. One descriptor is
bounded to depth 64, 4,096 nodes, 1,024 characters per name and 65,536 name
characters overall. `sourceTypeIdentities(types)` validates image declarations
and returns a Map from physical owner names to owned descriptors. It rejects
duplicate logical identities, collisions with physical definition names, open
arity, extra descriptor members and malformed array shapes, with a shared
131,072-node / 4 MiB name budget. `verifyImage` includes this admission.

The source CIL emitter preserves the optional identity in each `#SF` type
mapping. With `includeDebug: false`, an assembly containing source construction
identities retains a minimal `SharpForge.TypeIdentity` version-1 payload in
`#SF`; sources, sequence points and source instruction mappings are omitted.
This is semantic type metadata, not executable code or a source-debug payload.
The public CIL `readSourceTypeIdentities(metadataOrInspector)` function returns a Map from
TypeDef tokens to owned descriptors. It rejects malformed descriptors,
duplicate tokens, non-TypeDef tokens, and aliases colliding with any physical CLI
type definition. An inspector reuses its decoded profile rather than parsing
the metadata JSON again. The canonical source loader still verifies re-emission of
the complete assembly before creating source instructions.

These projections belong to the SharpForge source execution profile. Running
its monomorphized emitted DLL on the native CLR still exposes the physical
TypeDefs through CLR reflection; native CLR reflection equivalence is not
claimed for that path. The separate `compileToAssembly` bound-tree emitter and
arbitrary native assemblies retain their real CLI GenericParam/TypeSpec
metadata and use the existing generic runtime identities without projections.

Framework constructions deliberately erased to a shared registry type, such as
some `Task<T>` constructions represented as `Task<object>`, retain their
identity-sensitive source diagnostics. This change does not silently give those
erased values a false runtime type.

Focused coverage is in `tests/a05-source-generic-type-identities.test.js` and
`tests/a05-generic-boxed-bcl-callback.test.js`: source, reloaded source, emitted
CIL with and without debug information, production bound-tree CIL emission,
independently authored real CLI generics, boxing/unboxing, BCL callbacks,
nested/array arguments, type identity separation and malformed descriptors.
Native SDK execution remains a separate qualification step.
