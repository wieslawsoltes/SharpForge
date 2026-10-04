# StringBuilder signed/unsigned 64-bit append reference

SDK 10.0.201/runtime 10.0.5 capture 26 bounded Append(long)/Append(ulong) cases
and a mixed fluent control. Values remain decimal strings in JSON so JavaScript
Number never rounds the oracle. Cases include signed/unsigned limits, both sides
of 2^53, zero, null receivers, typed variables and same-builder identity. The
fluent control also includes the released character, Int32 and Boolean overloads.

```sh
dotnet build BuilderAppendInt64.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderAppendInt64.dll ../string-builder-append-int64-net10.json
```

Root captures once in the serial queue; tests consume the unchanged source hash
and outputs. Existing host text budgets and chunk capacity policies remain separate.
