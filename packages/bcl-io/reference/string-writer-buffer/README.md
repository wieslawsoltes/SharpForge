# StringWriter character-buffer reference

Pinned SDK 10.0.201/runtime 10.0.5 capture both full-array and slice Write calls
through StringWriter and TextWriter views. Seventy rows retain input/output UTF-16
units, fault type and native parameter name, including null, empty, boundary,
surrogate, disposed and null-receiver combinations. Parameter names document
validation precedence; this batch does not add ArgumentException.ParamName.

```sh
dotnet build WriterBuffer.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/WriterBuffer.dll ../string-writer-buffer-net10.json
```

Root captures once with build output separate from JSON. Ordinary tests consume
the snapshot without native execution. Managed host allocation budgets and write
observer failures are tested separately; they are not CLR allocation guarantees.
