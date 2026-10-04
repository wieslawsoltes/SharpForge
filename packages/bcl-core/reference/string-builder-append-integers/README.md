# StringBuilder small-integer append reference

SDK 10.0.201/runtime 10.0.5 capture 53 bounded cases for `Append(sbyte)`,
`Append(byte)`, `Append(short)`, `Append(ushort)` and `Append(uint)`. Each type
includes its limits, zero, representative values, a null receiver, an empty
builder and same-builder identity. UInt32 includes both sides of the signed
Int32 boundary and its full unsigned maximum. JSON inputs remain exact decimal
strings. A mixed fluent control also exercises the released Int32 and Char
overloads.

```sh
dotnet build BuilderAppendIntegers.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderAppendIntegers.dll ../string-builder-append-integers-net10.json
```

Root captures once in the serial queue. Tests retain this source hash and the
unchanged output; culture is explicitly invariant. Host text budgets and chunk
capacity policies remain separate.
