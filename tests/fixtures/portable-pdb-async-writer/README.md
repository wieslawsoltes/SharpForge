# Explicit async stepping writer reference

`AsyncWriter.dll` is compiled from `packages/symbols/interop/AsyncWriter/Program.cs`.
The native System.Reflection.Metadata reader in that program captures kickoff
links and exact async stepping blobs for a two-await Task method, an async-void
method with a catch offset, and an iterator without async stepping information.
The methods are compiled but never executed. `reference.json` records SDK/runtime
and compiler versions, plus compiler, source, assembly, original PDB and rewritten
PDB SHA-256 identities.

Generate explicitly in the serial validation slot:

```
DOTNET_PATH=/path/to/dotnet node scripts/limited.js node scripts/validate-pdb-async-writer.mjs --capture tests/fixtures/portable-pdb-async-writer
```

The script builds once, reads the original native PDB, gives its explicit mappings
to `emitPortablePdb`, and asks native SRM to read the rewritten PDB. All three
methods and complete CDI bytes must agree before capture. Offline tests only read
these files. This fixture qualifies the explicit input writer on its recorded SDK;
it does not claim automatic SharpForge async lowering, state reconstruction,
async-iterator mapping, or the three-version/debug-release matrix in T03.5.
