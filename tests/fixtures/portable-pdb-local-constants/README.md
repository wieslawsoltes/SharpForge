Captured explicitly with
`DOTNET_PATH=/path/to/dotnet node scripts/limited.js node scripts/validate-pdb-local-constants.mjs --capture tests/fixtures/portable-pdb-local-constants`.
Offline tests never build or rewrite this corpus.

Roslyn C# Debug emits 18 local constants: every primitive, string/object/class null,
an enum and decimal. Native SRM reads the original signatures and scalar values;
compiler, source, DLL and PDB hashes identify the reference. Decimal's type-dependent
payload remains explicitly unresolved by this first structural-reader increment.
This fixture does not qualify VB DateTime, custom modifiers produced by a compiler,
or the full cross-platform/compiler matrix.
