# Module-only output

`compileToIL(source, { outputKind: 'netmodule', name: 'Part' })` compiles definitions
through the existing library compilation path and emits `Part.netmodule` as its Module
name, with no Assembly row or entry point. The compiler's `outputKind: 'module'` spelling
is also accepted. `moduleName` overrides the file name stored in metadata; it must be a
nonempty bounded leaf name. PE bytes remain in the existing result's `assembly` property.
Portable PDB output and deterministic MVID/checksum handling continue to work normally.

`MetadataBuilder(name, { outputKind: 'netmodule' })` provides the same module-only manifest
behavior to low-level emitters. Assembly version/culture and independent signing options
are rejected because a netmodule has no Assembly identity. Desktop netmodules omit the
standalone native import/entry thunk. `readPE`/`inspectAssembly` inspect module metadata
without requiring an Assembly table; inspection never executes its code.

Standalone source/direct runtime execution is unsupported: a netmodule belongs to a
containing assembly. ModuleRef resolution, File/ExportedType linking and multi-module
execution remain separate work under SF-A03-T03.10. This slice provides module emission
and inspection only. Native SRM on .NET 10.0.5 confirms all four emitted platforms;
seven focused tests pass, including Portable PDB, deterministic bytes, malformed options
and the explicit standalone execution diagnostic. Browser/cross-platform qualification
remains open; reading architecture headers does not claim native execution on each target.

## Linking metadata modules

`compileToIL(source, { linkedModules: [moduleBytes, ...] })` links netmodules into an
assembly manifest. It writes File rows with SHA-256 hashes (Assembly HashAlgId 0x800c),
ModuleRef names, and ExportedType rows for public/nested-public definitions. Parent exports
precede nested exports and preserve actual TypeDef row hints. Input order determines token
order; repeated builds remain deterministic. Compiler-generated netmodule scaffolding is
internal so modules can coexist; existing assembly scaffold visibility is unchanged.

Low-level `linkAssemblyModules(metadataBuilder, byteInputs)` writes the same rows before
`finish()`. Call it once, after local TypeDefs and before other File/ExportedType rows.
It returns `{ name, fileToken, moduleRefToken, exportedTypes }` records; each export has
`token`, full `name`, and `typeDefId`. It does not retain or mutate input bytes. Invalid
inputs are rejected before modifying the builder. Existing matching ModuleRefs are reused.

`readAssemblyModules(readPE(bytes))` returns metadata-only module records with `name`,
`fileToken`, optional `moduleRefToken`, `hashAlgorithm`, copied `hashValue`, and flat
`exportedTypes` records (`token`, `name`, `namespace`, `flags`, `typeDefId`, `implementation`).
Nested exports retain their enclosing ExportedType token. Forwarded types and resource-only
File rows are not linked modules. This reader never accesses paths or loads module code.

Bounds: 128 input modules, 64 MiB aggregate input bytes, 65536 aggregate TypeDefs,
16384 candidate public/nested-public exports, nesting depth 64 and bounded metadata names.
Duplicate module file names (case-insensitive), duplicate exported names, assembly images,
entry points, invalid nesting and excessive inputs produce CilError/SF3001. Netmodules
cannot themselves contain an assembly manifest. Hash readers reject values over 64 bytes
before copying. The writer uses existing metadata seams and the shared SHA-256 primitive;
there is no new runtime dependency.

This supplies manifest linking and inspection, not compiler external-type binding or CLR
module resolution. Both JavaScript execution engines reject multi-module assemblies with
an explicit unsupported diagnostic. Native SRM on .NET 10.0.5 confirms both module hashes, TypeDef hints and the nested
export chain; the fixture combines SharpForge Alpha with Roslyn 5.3.0 Beta. All 16
linking/module tests pass, including legacy assembly visibility, malformed tables and
Buffer ownership. Evidence is under `tests/fixtures/a03-module-linking`. Browser, native
execution and inherited A00 qualification remain open under SF-A03-T03.10.

Exported type implementation chains follow [ECMA-335 II.6.7 and II.22.14](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
