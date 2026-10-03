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
and inspection only. Native reference captures and focused validation are pending.
