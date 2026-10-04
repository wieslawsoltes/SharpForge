# StringWriter through Object.ToString

SDK 10.0.201 and runtime 10.0.5 are pinned. Reflection.Emit invokes the actual
Object.ToString `call` and `callvirt` instructions for empty, written, disposed,
post-disposal builder mutation and null states. The ten-row output includes a
source hash. Root captures once; ordinary tests only read the committed JSON.

```sh
dotnet build StringWriterObject.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/StringWriterObject.dll ../string-writer-object-net10.json
```

Build output remains separate from the reference artifact. Independent CIL
tests use the same receiver states; source tests exercise actual object locals.
