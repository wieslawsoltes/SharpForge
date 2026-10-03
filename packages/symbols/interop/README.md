# Portable PDB native interoperability

Run `node scripts/validate-pdb-srm.js` using Node 24 and .NET SDK 10. The script
builds this SRM reader in a temporary directory, reads SharpForge-emitted symbols,
and compiles `RoslynFixture.cs` with each configured Roslyn compiler. Set
`SF_PDB_COMPILERS` to a JSON array of `{name, path}` records identifying additional
`csc.dll` versions. The installed SDK's compiler is always included. No native
compiler or package download occurs implicitly. Output records exact SDK/compiler
versions and hashes; fewer than two compiler versions fails the complete gate.
Use `--allow-single-compiler` only for an explicitly partial local diagnostic run.

Reference formats are Portable PDB v1.0 and Roslyn's
`EditAndContinueMethodDebugInformation` / `MetadataWriter.PortablePdb` records.
The tool checks document-name bytes against SRM, structured CDI round trips
against actual compiler output, import/constant readback, source hashes and PE
identity/checksum records. It does not claim debugger or managed execution parity.
