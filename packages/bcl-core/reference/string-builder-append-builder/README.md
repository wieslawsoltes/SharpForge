# StringBuilder source-builder append reference

SDK 10.0.201/runtime 10.0.5 capture 21 bounded `Append(StringBuilder)` cases:
null/empty sources, null receivers, self append, distinct segmented builders,
NUL, paired and isolated UTF-16 units, same-builder identity and unchanged
distinct source content. The largest initial builder contains 65 units.

```sh
dotnet build BuilderAppendBuilder.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderAppendBuilder.dll ../string-builder-append-builder-net10.json
```

Root captures once in the serial queue; tests consume the unchanged source hash
and native output units. Managed allocation limits, write observers and GC are
separate host-profile controls, not native concurrency claims.
