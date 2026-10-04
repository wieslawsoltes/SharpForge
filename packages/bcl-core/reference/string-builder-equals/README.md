# StringBuilder.Equals(StringBuilder) reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringBuilderEquals.csproj --configuration Release -- ../string-builder-equals-net10.json
```

The capture distinguishes typed content equality from inherited object equality.
It records identity, null receiver/source behavior, exact UTF-16, different append
segmentation, cleared/truncated/grown histories and unequal capacities. Before
and after states include text, length, capacity, MaxCapacity and native chunk count.

Rows marked nativeOnly require the unsupported constructor(capacity,maxCapacity).
They remain native evidence that maximum capacities do or do not influence
equality, not a claim that those constructor profiles run in SharpForge. Ordinary
tests use only registered constructors and mutations. Object.Equals behavior,
equality interfaces, hashing and span overloads are outside this API increment.
Raw text serializes as UTF-16 unit arrays; source SHA-256 freezes the program.
