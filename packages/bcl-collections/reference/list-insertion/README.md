# List insertion reference

SDK 10.0.201 and runtime 10.0.5 are pinned without roll-forward. This fixture
records Insert at the front/middle/end, AddRange with and without growth,
independent copies, appending a snapshot of the same List, empty input, null and
managed string retention. It runs unchanged on both SharpForge VMs. Released
validation and mutation-version policies are tested separately.

The root validation scheduler captures once from this directory:

```sh
dotnet run --project ListInsertion.csproj --configuration Release --verbosity quiet > ../list-insertion-net10.txt
```
