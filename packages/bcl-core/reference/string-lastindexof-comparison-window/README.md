# String.LastIndexOf bounded-window comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringLastIndexOfComparisonWindow.csproj --configuration Release -- ../string-lastindexof-comparison-window-net10.json
```

This capture calls `LastIndexOf(string, int, int, StringComparison)` and records
absolute UTF-16 offsets, start/count inputs, identity, faults and parameter names.
It keeps all 246 whole-mode inputs at Length - 1 / Length, then adds empty-receiver
-1/0 and arbitrary count inputs, Length aliases, zero counts, integer extremes,
null/enum/start/count precedence, every small backward window, pair cuts,
overlaps and periodic hits outside either window bound. Whole-string controls
are recorded separately for successful bounded calls.

CurrentCulture is invariant. Actual culture outputs and all unusual range
outcomes remain unchanged in the oracle. Source SHA-256 pins the capture bytes;
behavior is not inferred from forward IndexOf. Other APIs and culture backend
implementation remain outside this fixture's scope.
