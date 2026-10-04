# String.IndexOf bounded-window comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringIndexOfComparisonWindow.csproj --configuration Release -- ../string-indexof-comparison-window-net10.json
```

The capture calls `IndexOf(string, int, int, StringComparison)` and records exact
absolute UTF-16 offsets, start/count windows, units, identity, faults and parameter
names. The existing 218 mode-only inputs remain as complete-window controls.
Additional cases cover null/enum/start/count precedence, every valid window in a
small boundary corpus, empty/end windows, overlaps, surrogate cuts at both bounds,
8/9-unit thresholds and long periodic searches with hits inside/outside the window.
Native culture results remain unchanged with CurrentCulture pinned invariant.

SharpForge's partial profile preserves native null, enum and range faults, then
rejects otherwise valid culture modes explicitly. Source SHA-256 pins these
capture bytes. Other overloads and culture backend implementations remain outside
this fixture's scope.
