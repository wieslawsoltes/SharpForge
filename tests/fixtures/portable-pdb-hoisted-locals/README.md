# Roslyn C# hoisted local scope fixture

The source in `packages/symbols/interop/HoistedLocals` declares `first` across three
awaits and `nested` inside the second await's block. Its native SRM reader extracts
the MoveNext/kickoff tokens, generated field tokens/names, async offsets and hoisted
scope ranges. Fixture methods are compiled but never executed. The capture script
checks the expected live names (`first`; `first,nested`; `first`) and matches every
returned field token/name and range to the native data before writing the fixture.
Compiler/source/assembly/PDB SHA-256 and tool versions are recorded in `reference.json`.

Run only in the serial validation slot:

```
DOTNET_PATH=/path/to/dotnet node scripts/limited.js node scripts/validate-pdb-hoisted-locals.mjs --capture tests/fixtures/portable-pdb-hoisted-locals
```

Ordinary tests read the captured files without rebuilding or updating them.
This is one Roslyn C# Debug reference; Visual Basic, closure reconstruction and
multi-version/Release qualification remain separate work.
