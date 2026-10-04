# StringBuilder character indexer reference

SDK 10.0.201 and runtime 10.0.5 capture 44 bounded get/set cases against the native
`Chars` indexer. Cases include each segment boundary, negative and Int32-limit
indices, empty and null builders, NUL and isolated surrogate units. The snapshot
retains exception types and parameter names, exact UTF-16 output, length and
capacity before/after; it is not an assertion of matching native chunk layout.

```sh
dotnet build BuilderIndexer.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderIndexer.dll ../string-builder-indexer-net10.json
```

Root executes the capture in the serial queue. Tests consume the unchanged JSON
and verify its Program.cs hash. Managed GC/observer/OOM controls remain separate.
