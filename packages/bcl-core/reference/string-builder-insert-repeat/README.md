# StringBuilder repeated string insertion reference

Capture using SDK 10.0.201 and runtime 10.0.5 from this directory:

```sh
dotnet run --project StringBuilderInsertRepeat.csproj --configuration Release -- ../string-builder-insert-repeat-net10.json
```

The 206 bounded cases capture text as UTF-16 units, fluent identity, exact fault
type/parameter and native length/capacity/chunk evidence. They cover null receiver,
negative-count/index precedence, null/empty values, zero count, segmented inputs,
NUL, isolated and split surrogates, and repeated literal dollar text. The separate
fluent control records receiver/index/value/count evaluation order.

Int32.MaxValue repeat counts occur only with null/empty input or an index that is
rejected before repetition. Every positive count with nonempty input and valid
receiver/index is at most 17. The program cannot attempt a huge repeated result.
Capacity/chunk data remains evidence for the existing runtime storage profile.
The JSON pins this exact source with SHA-256. Only root executes capture/validation.
