# String.Compare range comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringCompareComparisonRanges.csproj --configuration Release -- ../string-compare-comparison-ranges-net10.json
```

This captures only String.Compare(string, int, string, int, int, StringComparison).
Raw native results and signs are separate because the public contract specifies
negative, zero or positive results. Exact UTF-16 units, offsets, requested length,
reference identity, faults, parameter names and source SHA-256 are preserved.

Cases cover independently clipped suffixes, maximum Int32 lengths, invalid-mode
priority, null ordering before invalid ranges, length/negative-index/endpoint
priority, identity and zero-length shortcuts, Unicode ordinal folding, NUL and
surrogate pairs cut at either range boundary. Offset boundary controls use prefix
lengths 7, 15 and 31.

CurrentCulture is pinned to InvariantCulture. Native culture results and faults
remain unchanged in the oracle. SharpForge explicitly rejects modes 0–3 before
null, range validation and identity shortcuts; tests identify this intentional
profile difference separately. Other overloads and culture implementation are
outside this fixture's scope.
