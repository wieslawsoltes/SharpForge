# String.LastIndexOf start-index comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringLastIndexOfComparisonStart.csproj --configuration Release -- ../string-lastindexof-comparison-start-net10.json
```

The capture calls `LastIndexOf(string, int, StringComparison)` and records exact
UTF-16 offsets, inclusive start indices, receiver/value units, identity, faults
and parameter names. All 246 original mode-only inputs remain as controls using
Length - 1. It also captures whole-string LastIndexOf on successful calls.

Additional rows cover empty receivers at -1/0, start == Length, invalid integer
extremes, null/enum/range precedence, empty values, every prefix in a small UTF-16
corpus, pair cuts, overlaps and periodic matches before/after the selected end.
CurrentCulture is invariant; actual culture outcomes are retained unchanged.
The native source SHA-256 pins these capture bytes. The count overload and culture
backend implementations are outside this fixture's scope.
