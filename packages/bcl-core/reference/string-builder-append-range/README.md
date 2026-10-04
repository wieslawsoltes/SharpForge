# StringBuilder string-range append reference

SDK 10.0.201/runtime 10.0.5 capture 52 bounded `Append(string, int, int)`
cases. The corpus includes competing negative/null/range faults, zero-count
calls with starts beyond the input (including Int32.MaxValue), null receivers,
same-builder identity, NUL, surrogate pairs and isolated UTF-16 units. Int32
extremes only occur in invalid or zero-count cases; inputs never exceed 129 units.

```sh
dotnet build BuilderAppendRange.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderAppendRange.dll ../string-builder-append-range-net10.json
```

Root captures once in the serial queue. Tests consume the unchanged native
source hash, output units and fault/parameter names. Host allocation limits and
managed mutation-observer behavior are tested separately from this native oracle.
