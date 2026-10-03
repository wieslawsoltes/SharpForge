# ECMA-335 metadata table fixtures

`fixture.js` constructs an independent metadata-only module covering definition/layout,
manifest forwarding and linked resources, imports/marshaling/security, event semantics,
generic rows and required table sorting. `defects.js` declares 40 one-defect serialized
variants, each with one expected stable `MDxxxx` diagnostic.

`oracle/Program.cs` reads the metadata root with the real System.Reflection.Metadata
reader and records the observations in `srm.json`. It uses table-specific APIs, including
binary-search lookups for layout, constants, method imports, interfaces and overrides.
The test compares those observations against the JavaScript reader. The oracle does not
load or execute the assembly, and its acceptance does not prove CLR executability.

Regenerate using .NET SDK 10.0.201 and Node 24.21.0, sequentially:

```sh
node tests/fixtures/a03-metadata/oracle/prepare.js /tmp/a03-metadata.bin
dotnet run --project tests/fixtures/a03-metadata/oracle/MetadataOracle.csproj --disable-build-servers -m:1 -p:BaseIntermediateOutputPath=/tmp/a03-srm-obj/ -p:OutputPath=/tmp/a03-srm-bin/ -- /tmp/a03-metadata.bin > tests/fixtures/a03-metadata/srm.json
node --test --test-concurrency=1 tests/a03-01-*.test.js tests/cil-table-widths.test.js
```

The existing Roslyn reader corpus in `../metadata` (SDK 10.0.201) and external Portable
PDB fixture are also validated. No fixture is substituted for native execution evidence.
