# List range-removal reference

SDK 10.0.201 and runtime 10.0.5 are pinned without roll-forward. This fixture
checks tail and middle removal, retained capacity, independent array copies,
empty valid ranges and reuse after complete removal. It runs unchanged on both
SharpForge VMs. Released range-validation exception and mutation-version rules
are tested separately; this fixture does not claim complete List API parity.

The root validation scheduler captures once from this directory:

```sh
dotnet run --project ListRemoval.csproj --configuration Release --verbosity quiet > ../list-removal-net10.txt
```
