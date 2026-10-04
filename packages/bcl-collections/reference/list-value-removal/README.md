# List value-removal and Clear reference

SDK 10.0.201 and runtime 10.0.5 are pinned without roll-forward. The same fixture
runs through both SharpForge VMs and records first-match removal, null, missing
values, capacity retention, independent copies, Clear/reuse and boxed primitive
type distinctions. Released mutation-version rules are tested separately; empty
Clear remains a no-op in the existing profile rather than claiming .NET parity.

The root validation scheduler captures once from this directory:

```sh
dotnet run --project ListValueRemoval.csproj --configuration Release --verbosity quiet > ../list-value-removal-net10.txt
```
