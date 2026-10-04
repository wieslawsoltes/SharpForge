# Integer dictionary JSON reference

SDK 10.0.201 and runtime 10.0.5 are pinned without roll-forward. The native
wrapper captures `Cases.cs` output and its source hash in the committed oracle.

Run once from this directory, in the scheduled native validation slot:

```sh
dotnet run --project JsonIntegerKeys.csproj --configuration Release --verbosity quiet > oracle.json
```

Coverage includes every registered dictionary value profile, signed Int32 key
boundaries, nonmonotonic keys, update/removal/re-addition/clear, growth and free
slot reuse, nested dictionaries, escaping, numeric spelling and cycles.
The source and CIL tests consume the committed oracle without starting .NET.
Both compiler pipelines run the fixture through the source and CIL VMs with its
original character argument. Every run compares all eighteen native output rows
and verifies genuine managed Boolean, Char, Int32 and Double boxes, including the
Char's UTF-16 payload. An independently assembled CIL fixture also compares its
genuine boxed Char with the complete original mixed-object dictionary row.
These assertions replace the former `SF2003` rejection and character-to-string
adaptation after scalar lowering and Char boxing made that source expression
supported. The native source and captured oracle remain unchanged.

The source harness also replaces exactly one typed `JsonException` catch with
`Exception`, because typed catches remain unsupported. A separate uncaught cycle
case verifies the actual runtime fault name against the unchanged native oracle.
