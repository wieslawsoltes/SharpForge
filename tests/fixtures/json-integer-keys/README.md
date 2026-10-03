# Integer dictionary JSON reference

SDK 10.0.201 and runtime 10.0.5 are pinned without roll-forward. `Cases.cs` is
the same program executed by the source and CIL regression tests. The native
wrapper captures its output and source hash in the committed oracle.

Run once from this directory, in the scheduled native validation slot:

```sh
dotnet run --project JsonIntegerKeys.csproj --configuration Release --verbosity quiet > oracle.json
```

Coverage includes every registered dictionary value profile, signed Int32 key
boundaries, nonmonotonic keys, update/removal/re-addition/clear, growth and free
slot reuse, nested dictionaries, escaping, numeric spelling and cycles.
The source and CIL tests consume the committed oracle without starting .NET.
