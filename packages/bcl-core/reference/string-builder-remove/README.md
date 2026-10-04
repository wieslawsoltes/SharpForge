# StringBuilder.Remove native reference

Run with SDK 10.0.201 and runtime 10.0.5 from this directory:

```sh
dotnet run --project StringBuilderRemove.csproj --configuration Release -- ../string-builder-remove-net10.json
```

The 150 bounded cases capture UTF-16 code units, fluent identity, exact exception
type and parameter name, length, capacity, and native chunk-count evidence. They
include null receivers, competing invalid arguments, Int32 endpoints, valid and
invalid empty ranges, cross-chunk removal, NUL, and isolated or split surrogates.
The JSON records the unchanged program's SHA-256 hash. Runtime tests compare
capacity preservation rather than claiming identical native chunk growth.

Only the root agent runs the pinned native capture and validation queue.
