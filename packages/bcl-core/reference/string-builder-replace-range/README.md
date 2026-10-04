# StringBuilder.Replace string-range reference

Capture using SDK 10.0.201 and runtime 10.0.5 from this directory:

```sh
dotnet run --project StringBuilderReplaceRange.csproj --configuration Release -- ../string-builder-replace-range-net10.json
```

The 230 bounded cases capture literal UTF-16 content, fluent identity, exception
type and parameter, length, capacity, and native chunk counts. Cases include
competing null/empty old strings and invalid ranges, Int32 endpoints, null
receivers, null/empty replacements, original-window boundaries, nonoverlapping
matches, growth, literal dollar patterns, chunk crossings, NUL, and split or
isolated surrogate units. Capacity and chunk counts are retained as native
evidence; the runtime's existing storage/capacity profile remains separate.

The JSON records the exact program SHA-256. Only the root agent executes native
capture and validation; the fixture itself performs no unbounded allocation.
