# StringBuilder character append reference

Pinned SDK 10.0.201/runtime 10.0.5 records Append(char) and Append(char, int):
37 bounded cases cover exact UTF-16 units, empty/seeded builders, fluent identity,
zero/positive/negative repeat counts, null receivers and validation precedence.
A seeded builder plus Int32.MaxValue safely proves MaxCapacity rejection before expansion.
Negative counts retain native ArgumentException.ParamName (`repeatCount`).

Native capacity before/after is recorded as evidence. Existing SharpForge chunk
growth does not yet reproduce every native Capacity transition; this slice checks
capacity while no growth is needed and preserves the existing allocation profile.
Managed host MAX/OOM tests are separate; native runs never request huge repeats.

```sh
dotnet build BuilderAppendChar.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderAppendChar.dll ../string-builder-append-char-net10.json
```

Root captures once with build output separate from JSON. Tests consume the frozen
snapshot. Indexer, other Append overloads and full capacity parity remain tracked.
