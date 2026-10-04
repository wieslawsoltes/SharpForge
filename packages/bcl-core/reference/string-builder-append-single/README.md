# StringBuilder Single append reference

SDK 10.0.201/runtime 10.0.5 capture 44 bounded `Append(float)` cases and a
mixed fluent control. Every input is constructed from an explicit 32-bit IEEE
pattern; JSON stores the input and observed bits as eight-digit hexadecimal
strings, never as transported decimal floats. Cases cover signed zero, ordinary
rounding, 10^8/10^9 and 10^-4 neighbors, subnormals, minimum normals, finite
endpoints, NaNs, infinities, null receivers and same-builder identity.

Each row also records default Single text and the corresponding widened Double
text, so a formatter prerequisite can preserve the existing binary64 behavior.

```sh
dotnet build BuilderAppendSingle.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/BuilderAppendSingle.dll ../string-builder-append-single-net10.json
```

Root captures once in the serial queue. The native source and captured outputs
remain unchanged evidence; no broad Single-format or configurable-culture claim
follows from this default invariant append corpus.
