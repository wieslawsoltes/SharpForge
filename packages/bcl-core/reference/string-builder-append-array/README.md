# StringBuilder character-array append reference

SDK 10.0.201/runtime 10.0.5 capture 61 bounded `Append(char[])` and
`Append(char[], int, int)` cases. The corpus records null arrays and receivers,
competing negative and overflowing ranges, zero count, NUL and paired/isolated
UTF-16 surrogate units, final text/length, fluent identity, fault type and
parameter name. Text is stored as numeric UTF-16 units so isolated surrogates
survive JSON serialization unchanged.

```sh
dotnet build BuilderAppendArray.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderAppendArray.dll ../string-builder-append-array-net10.json
```

Root runs this capture once in the serial queue. Tests consume the committed
native output and source hash; host text limits and managed chunk capacity
policies are tested separately.
