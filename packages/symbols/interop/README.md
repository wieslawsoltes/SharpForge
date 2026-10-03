# Portable PDB native interoperability

Run `node scripts/validate-pdb-srm.js` using Node 24 and .NET SDK 10. The script
builds this SRM reader in a temporary directory, reads SharpForge-emitted symbols,
and compiles `RoslynFixture.cs` and `RoslynFixture.vb` with each configured Roslyn compiler. Set
`SF_PDB_COMPILERS` to a JSON array of `{name, path}` records identifying additional
`csc.dll` versions with sibling `vbc.dll` binaries. The installed SDK's compiler is always included. No native
compiler or package download occurs implicitly. Output records exact SDK/compiler
versions and hashes; fewer than two compiler versions fails the complete gate.
Use `--allow-single-compiler` only for an explicitly partial local diagnostic run.

Reference formats are Portable PDB v1.0 and Roslyn's
`EditAndContinueMethodDebugInformation` / `MetadataWriter.PortablePdb` records.
The tool checks document-name bytes against SRM, structured CDI round trips
against actual compiler output, import/constant readback, source hashes and PE
identity/checksum records. It does not claim debugger or managed execution parity.

Pass `--capture-fixtures tests/fixtures/portable-pdb-interop/records.json` to
refresh the offline CDI regression corpus after the native gate succeeds. This
retains exact compiler-emitted records, compiler/source/PDB hashes and versions;
ordinary Node tests do not invoke native tools or access the network. Embedded
source compression is checked by native readback and separate zlib-backed tests;
its compressed bytes need not match Roslyn's compressor. Source Link, declaration
only types, and Visual Basic's root namespace are explicit fixtures.

The recorded run uses .NET SDK 10.0.201 (Roslyn 5.3.0) and the unmodified
Microsoft.Net.Compilers.Toolset 4.8.0 package, downloaded explicitly as reference
tooling from NuGet. It adds no product dependency. Compiler hashes are in
[the native report](../../../../docs/pdb-interop.json). This gate requires the .NET 10
reference pack even when running an older compiler.
