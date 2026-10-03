# List Reverse reference

SDK 10.0.201 and runtime 10.0.5 are pinned without roll-forward. This fixture
records parameterless Reverse on fresh and reserved empty Lists, a singleton,
odd/even live prefixes, repeated reversal, independent copies and nullable
managed strings. It runs unchanged on both SharpForge VMs. Mutation versions,
write observers, allocation failure and GC during swaps are tested separately.

The root validation scheduler captures once from this directory:

```sh
dotnet run --project ListReverse.csproj --configuration Release --verbosity quiet > ../list-reverse-net10.txt
```
