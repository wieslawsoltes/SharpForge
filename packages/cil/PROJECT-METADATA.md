# Project metadata emission and canonical replay

The public `emitAssembly(image, options)` and `emitAssemblyDetailed(image, options)`
APIs emit project metadata into real PE/CLI tables. The detailed result retains the
existing `{bytes, debug, symbolData, metrics, framework}` shape. Metadata options do
not execute attribute constructors or load referenced assemblies. Invalid input
throws `CilError`; canonical project-reference inconsistencies use `PRJ0001`.

## Assembly, resource and source type options

`assemblyAttributes` is an array of `{type, value}` string records, limited to 256
records and 1 MiB of UTF-8 values. The supported SDK subset covers company,
configuration, copyright, description, file/informational version, product, title,
neutral resource language, target framework and `InternalsVisibleTo` attributes.
Only friend declarations may repeat. `AssemblyVersionAttribute` instead updates the
Assembly row and requires a deterministic two-to-four-part numeric version with
components at most 65534. Conflicting explicit `assemblyVersion` is rejected.
General C# source attribute binding is a separate compiler concern.

`resources` contains `{manifestName, bytes, isPublic?}` records. Bytes must be
`Uint8Array`; visibility defaults to public and `isPublic:false` selects private.
Names are unique, nonempty, NUL-free and at most 1024 characters. The limit is 4096
resources and 64 MiB including per-record framing. The existing managed-resource
writer creates the CLI directory. Supplying both nonempty project `resources` and
`managedResources` is rejected. Culture and assembly identity continue through the
existing metadata builder and canonical Assembly-row reader.

`typeDefinitions` maps exact image type names to `{name, namespace, access}`;
access is `public` or `internal`. Source name and namespace components are bounded
at 1024 characters. Compiler identities remain usable for method lookup while the
actual TypeDef rows retain source namespace and visibility. Existing internal
netmodule scaffolding remains internal. Omitting definitions preserves the earlier
public-type profile; supplying definitions makes unmatched generated types internal.

## Members, properties and initialization

`memberDefinitions` has version 1 shape `{version:1, methods:[{id,access}],
fields:[{type,index,access,isReadOnly}], statics:[{index,access,isReadOnly}]}`.
Every image method and field slot has one record. IDs are image indices; each table
is bounded at 100000 records. The six access values are `public`, `internal`,
`private`, `protected`, `protectedInternal` and `privateProtected`. Emission copies
and validates the records, writes real MethodDef/Field access and `initonly` flags,
and applies source constructor access to its actual CLI constructor wrapper.

Ordinary named properties retain PropertyMap, Property and MethodSemantics rows.
Canonical reconstruction reads each actual accessor flag, including family-and-
assembly and family-or-assembly, and rejects duplicate or invalid accessors.
Indexer signatures remain outside the existing canonical property profile.
Supplying no member definitions preserves the earlier member visibility profile.

Helper-based source initialization receives a genuine CLI `.cctor` that calls the
existing initialization helper. An existing actual `.cctor` is retained. Native
field access therefore triggers initialization without copying dependency methods.
`projectStaticInitializers:false` selects the former scaffolding when replaying an
older artifact; old debug metadata selects that compatibility behavior automatically.

## External references and replay

An image can carry the bounded `SharpForge.ProjectReferences/1` descriptor from
`@sharpforge/bytecode`. Emission writes actual AssemblyRef, scoped TypeRef and MemberRef
rows and lowers all six external operations to CLI calls, allocation and field access.
Local TypeDef and MethodDef tables contain only this image's definitions. Assembly
identity flags and separate versions are preserved; no display-name parsing is used
to recover an external type identity from its opaque image name.

`loadAssembly(bytes)` reconstructs the same unlinked external descriptor from actual
metadata rows and verifies reference token maps, scope, names and signatures. Its
instruction stream comes from actual CIL, not the debug profile. Canonical re-emission
checks the complete artifact, including resources, properties, attributes, helper
scaffolding and source/debug boundaries. Non-executable metadata choices are retained
in the bounded `#SF` project profile; resource bytes are read from the CLI directory.

Unlinked replay does not verify that dependency bytes are supplied, nor does it
authorize their execution. Full identity/hash/definition matching and closed-graph
runtime admission use the separate project assembly loader. Focused standalone tests
are `a23-project-emission`, `a23-member-definitions`,
`a23-upstream-emission-composition` and `a23-cil-project-profile`.
