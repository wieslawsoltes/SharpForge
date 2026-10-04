# String.Compare comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringCompareComparison.csproj --configuration Release -- ../string-compare-comparison-net10.json
```

The capture records the three-argument String.Compare overload's native integer
result, sign, exception type, parameter name and exact UTF-16 units. Product tests
compare signs: .NET specifies negative, zero or positive rather than a fixed
nonzero magnitude. Cases cover nulls, identity, separately allocated equal
strings, invalid enum values before shortcuts, ASCII and Unicode casing,
normalization, NUL, supplementary scalars and malformed surrogates.

CurrentCulture is pinned to InvariantCulture for the native culture-mode controls.
Their real .NET results are retained unchanged; SharpForge deliberately rejects
modes 0–3 with NotSupportedException before null or identity shortcuts. These rows
do not qualify culture support. Range and Boolean/culture overloads are outside
this fixture's scope.
