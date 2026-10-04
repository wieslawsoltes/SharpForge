# Roslyn Portable PDB CDI records

`records.json` contains exact records from the repository's C# and Visual Basic
fixture sources, compiled with Roslyn 5.3.0 and 4.8.0 and checked by native
System.Reflection.Metadata on .NET SDK 10.0.201. Compiler binaries, source files
and full generated PDBs are identified by SHA-256. Compiler binaries and generated
assemblies are not committed. Compilation metadata references describe the .NET
10 reference pack used for both compiler versions.

Generate explicitly with `scripts/validate-pdb-srm.js --capture-fixtures` as
described in `packages/symbols/interop/README.md`. Fixture source line endings are
normalized to LF before compilation. Normal tests are offline and never refresh
this file. They compare exact CDI bytes and source-relative local, lambda and
state offsets; source fixtures must be updated together with the captured corpus.
Embedded source is excluded from this JSON because its DEFLATE representation is
compressor-specific; separate zlib and SRM tests cover decompression.
