# Boolean StringBuilder insertion reference

Pinned SDK 10.0.201/runtime 10.0.5 capture for `Insert(int, bool)`: 71 bounded
rows plus one mixed fluent/evaluation-order control. Cases cover both Boolean
values, null/empty/segmented receivers, insertion endpoints and Int32 bounds,
aliased reads, NUL and surrogate boundaries, identity and native capacity/chunk
observations. A few invariant/French/Turkish culture rows establish Boolean
text behavior without claiming configurable culture support in SharpForge.

UTF-16 text is recorded as numeric unit arrays; Boolean inputs remain JSON
booleans. Extreme indices only operate on tiny builders and fail before growth.
Native capacity/chunk values remain evidence, not assertions that the current
managed flattening and capacity policy matches .NET storage.

Root captures the frozen program once in the serial queue, from this directory:

```sh
dotnet build -c Release --nologo
dotnet bin/Release/net10.0/StringBuilderInsertBool.dll ../string-builder-insert-bool-net10.json
```

Ordinary tests will consume the unchanged snapshot and its source hash. Managed
allocation limits, GC and write observers are separate host-profile controls.
