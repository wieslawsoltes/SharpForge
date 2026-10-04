# Exact JsonElement Int64 reference

`Cases.cs` and `oracle.json` are the unchanged native program and its 63 captured
output lines. SDK 10.0.201 and CoreCLR 10.0.5 are pinned without roll-forward.
Regenerate only in a scheduled native validation slot, from this directory:

```sh
dotnet run --project JsonInt64.csproj --configuration Release --verbosity quiet > oracle.json
```

The source compiler currently rejects Int64 execution (`SF2200`) and typed
catches (`SF2002`). The test reads the native program's thirty JSON input strings
and uses `engines.js` to execute matching source bytecode and independent CIL.
It asserts raw tokens, exact BigInt results, actual managed fault names, nested
access and disposal against all captured lines. Separate negative compilation
tests preserve the profile boundary; normal tests do not start native processes.
