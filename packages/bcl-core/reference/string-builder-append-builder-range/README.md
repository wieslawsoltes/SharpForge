# StringBuilder range append reference

SDK 10.0.201/runtime 10.0.5 capture the exact
`Append(StringBuilder, int, int)` overload. Bounded cases cover null sources and
receivers, competing negative ranges, zero-count upper bounds, Int32 extremes,
source preservation, fluent identity, self append and ranges crossing appended
segments. UTF-16 input/output is stored as code-unit arrays, preserving NUL and
isolated surrogates. Large counts occur only with tiny sources, so they fail
before allocating output.

```sh
dotnet build BuilderAppendBuilderRange.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderAppendBuilderRange.dll ../string-builder-append-builder-range-net10.json
```

Root captures the unchanged fixture in the serial queue. Managed host budgets,
GC and reentrant write observers are separate host-profile tests; they are not
native concurrency or capacity-parity claims.
