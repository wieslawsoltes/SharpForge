# StringComparer.Equals(string, string) reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringComparerEquals.csproj --configuration Release -- ../string-comparer-equals-net10.json
```

The bounded capture calls only the two-string Equals overload on Ordinal and
OrdinalIgnoreCase comparers, obtained from both the released getters and
FromComparison. It records null receiver precedence, nullable strings, actual
shared and distinct reference identity, length differences, case/normalization
edges, expansions, difficult Unicode scalars and malformed UTF-16. A successful
row also records the existing Compare sign as an agreement control.

Raw strings serialize as UTF-16 unit arrays. Source SHA-256 freezes the program.
CurrentCulture is invariant, but the selected comparisons are ordinal. Culture
comparers, equality interfaces, object overloads and hashing are outside this capture.
