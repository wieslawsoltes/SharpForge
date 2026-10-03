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
The compiler deliberately rejects source `char` values with `SF2003`. The
compiled fixture asserts and replaces exactly its one character argument with
the equivalent one-character string, which has identical native JSON bytes.
An independent assembled CIL fixture uses a genuine boxed `System.Char` and
compares the complete mixed-object dictionary with the original native row.
Both compiler pipelines also assert the unchanged source diagnostic.

The source harness also replaces exactly one typed `JsonException` catch with
`Exception`, because typed catches remain unsupported. A separate uncaught cycle
case verifies the actual runtime fault name against the unchanged native oracle.
