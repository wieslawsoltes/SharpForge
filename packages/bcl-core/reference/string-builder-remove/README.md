# StringBuilder.Remove native reference

Run with SDK 10.0.201 and runtime 10.0.5 from this directory:

```sh
dotnet run --project StringBuilderRemove.csproj --configuration Release -- ../string-builder-remove-net10.json
```

The 150 bounded cases capture UTF-16 code units, fluent identity, exact exception
type and parameter name, length, capacity, and native chunk-count evidence. They
include null receivers, competing invalid arguments, Int32 endpoints, valid and
invalid empty ranges, cross-chunk removal, NUL, and isolated or split surrogates.
The JSON records the unchanged program's SHA-256 hash. Native nonempty removal
can shrink capacity when chunks collapse (for example, `flat-prefix` changes
capacity from 5 to 4). Runtime tests preserve the released SharpForge capacity
policy and compare native text, length, fluent identity, and faults. Native
capacity and chunk topology after nonempty removal remain recorded evidence,
not a parity claim for this correction.

Only the root agent runs the pinned native capture and validation queue.
