# Non-generic comparer reference

Run from this directory with SDK 10.0.201 and runtime 10.0.5 installed:

```sh
dotnet run --project ArrayComparer.csproj --configuration Release -- ../array-comparer-net10.json
```

The output pins source bytes and runtime provenance. Its 33 cases exercise
StringComparer.Ordinal through System.Collections.IComparer, plus the exact
Array.BinarySearch(Array, object, IComparer) overload. Comparison signs are
normalized; binary-search indices and complemented insertion positions are not.
Both exception type and InnerException type are retained.

Managed source/CIL tests generate calls from the captured expressions. NaN cases
use direct managed-platform boxes because source double.NaN fields are outside
the current execution profile. Rank-two rejection uses a managed array header;
this does not claim source multidimensional-array construction support. Capture
and ordinary tests are separate, so test runs never launch the .NET toolchain.

Native implementation references:
- [StringComparer object comparisons](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/StringComparer.cs)
- [Array non-generic binary search](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Array.cs)

Default culture-sensitive comparison and arbitrary managed comparison callbacks
remain tracked by #829 and #2655 respectively. This corpus qualifies the explicit
ordinal/primitive profile, not arbitrary culture collation.
