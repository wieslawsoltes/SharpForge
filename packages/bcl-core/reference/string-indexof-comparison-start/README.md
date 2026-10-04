# String.IndexOf start-index comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringIndexOfComparisonStart.csproj --configuration Release -- ../string-indexof-comparison-start-net10.json
```

The standalone capture calls `IndexOf(string, int, StringComparison)` and records
absolute UTF-16 offsets, source units, start indices, identity, faults and parameter
names. It retains the 218 original IndexOf-mode inputs at start zero, then adds
nonzero windows, empty/end positions, invalid-range/mode/null combinations,
overlap, 8/9-unit needles and surrogate cuts at both candidate boundaries.
CurrentCulture is invariant; captured culture outputs are retained unchanged.

Receiver and value null checks precede enum validation; an invalid enum wins over
an invalid start index. Valid modes validate the inclusive 0..Length start range
before matching, including empty/identity shortcuts. SharpForge supports ordinal
modes only: valid culture modes fail explicitly after null, enum and range checks.
The native source SHA-256 pins these capture bytes. Count overloads are outside
this fixture's scope.
