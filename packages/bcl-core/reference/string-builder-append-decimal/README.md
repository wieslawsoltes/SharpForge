# StringBuilder Decimal append reference

SDK 10.0.201/runtime 10.0.5 capture 33 bounded `Append(decimal)` cases and a
mixed fluent Int32/Char control. Inputs retain an exact decimal coefficient
string, scale and sign, with native 96-bit storage words for provenance. Cases
include both signed limits, scales 0 through 28, trailing zeros, signed zeros,
values beyond Number's exact integer range, null receivers and empty builders.

```sh
dotnet build BuilderAppendDecimal.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderAppendDecimal.dll ../string-builder-append-decimal-net10.json
```

Root captures once in the serial queue. Tests preserve the native output and
source hash. Culture is explicitly invariant; host text budgets and chunk
capacity policies remain separate.
