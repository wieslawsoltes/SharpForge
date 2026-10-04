# List Sort storage reference

SDK 10.0.201 and runtime 10.0.5 are pinned without roll-forward. The fixture
records default integer and explicit ordinal string results, capacity retention,
duplicates, nulls and enumerator invalidation for fresh empty/singleton lists.
The default integer section runs unchanged through both SharpForge VMs. The
ordinal section is checked through each managed platform because the source
compiler does not yet lower IComparer<string> conversions. It does not qualify
culture defaults or custom comparer callbacks; those remain in #829 and #2655.

The root validation scheduler captures once from this directory:

```sh
dotnet run --project ListSortStorage.csproj --configuration Release --verbosity quiet > ../list-sort-storage-net10.txt
```

Ordinary tests consume the capture without launching .NET. Managed-platform
tests separately cover backing identity, write notifications, comparison fault
atomicity, root cleanup and observer-triggered garbage collection.
