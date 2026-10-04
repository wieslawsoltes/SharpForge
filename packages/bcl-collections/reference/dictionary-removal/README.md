# Dictionary removal order reference

The fixture pins SDK 10.0.201 and runtime 10.0.5. It records key/value order after
nonadjacent removals, reuse of multiple free slots, replacement, complete removal
without Clear, Clear/reuse, and signed Int32 boundary keys. The same source runs
through both SharpForge VMs. Key snapshots and mutation-version behavior remain
part of the existing closed collection profile rather than this order oracle.

The root validation scheduler captures once from this directory:

```sh
dotnet run --project DictionaryRemoval.csproj --configuration Release --verbosity quiet > ../dictionary-removal-net10.txt
```

The checked-in output is the native oracle; no timing claim follows from it.
