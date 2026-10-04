# Boxed object collection equality reference

`Program.cs` captures the native behavior for SF-A08-B01 (#828), using SDK
10.0.201 and runtime 10.0.5. `global.json` and the project disable version roll-forward.
The same source runs through SharpForge's source and CIL VMs in the regression.

From this directory, capture once with the pinned SDK:

```sh
dotnet run --project BoxedObjectEquality.csproj --configuration Release --verbosity quiet > ../boxed-object-equality-net10.txt
```

The checked-in output is the native oracle. Direct primitive arguments preserve
their boxed types at the existing BCL call boundary. General object local and
object-array boxing in the source compiler is a separate prerequisite; these
fixtures do not claim that broader compiler support.
