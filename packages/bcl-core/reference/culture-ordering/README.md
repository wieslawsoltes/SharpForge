# Culture ordering reference

Run from this directory with SDK 10.0.201 and runtime 10.0.5 installed:

```sh
dotnet run --project CultureOrdering.csproj --configuration Release -- ../culture-ordering-net10.json
```

The capture fixes CurrentCulture and CurrentUICulture to InvariantCulture and
records 97 nullable strings as UTF-16 unit arrays, preserving lone surrogates.
It records every pair's comparison sign, List.Sort output, and Array.BinarySearch
results under Comparer<string>.Default and StringComparer.Ordinal. Duplicate
keys may yield any equal position; culture-equal distinct strings need not keep
input order. The three-string default result `a, A, b` differs from ordinal
`A, a, b`. This is ICU-backed invariant culture, not the distinct .NET invariant
*globalization mode*, which the program rejects.

Committed provenance: .NET 10.0.5, SDK 10.0.201, macOS 26.6.0 Arm64;
CompareInfo.Version.FullVersion 34969 and SortId
`00008899-0000-0000-0000-00000000007f`. Environment switches are recorded. The
reference is not a portable collation table and does not qualify an arbitrary
JavaScript Intl.Collator or a different ICU version. Ordinal behavior is exact
UTF-16 ordering and independent of this culture backend.

The capture remains unchanged when adapting execution fixtures. Both VM
platforms consume every ordinal pair and sorted result. Compiled source covers
direct StringComparer calls; `tests/fixtures/comparers/ordinal.js` independently
assembles interface Compare/List.Sort, castclass and isinst. Source interface
locals/conversions, interface `is` and custom implementations retain their
explicit profile diagnostics instead of being treated as successful execution.

Follow-up #829 needs either a pinned portable collation implementation/data set,
or an explicitly qualified host provider with declared version, options and
backend identity. #2619 owns CompareInfo/CompareOptions, #2621 StringComparer
culture modes, and #2655 generic ordering. Binary search must use comparator
zero to identify matches, because distinct UTF-16 strings can be culture-equal.
