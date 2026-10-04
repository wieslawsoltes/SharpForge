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

Compiled source/CIL tests generate eleven supported direct StringComparer calls
from the captured expressions. Interface conversions, custom implementations,
new object construction and double.NaN fields are not assumed to lower in that
source profile. `tests/fixtures/comparers/array.js` independently assembles all
32 vector operations, including true IComparer.Compare dispatch, boxed values,
NaN and opaque-object identity. Separate CIL methods use a typed catch and the
actual InnerException getter for every captured wrapped failure. Both VM
platforms also check wrapped-fault GC roots and custom-comparer rejection.

Rank-two rejection uses a managed array header; this does not claim source
multidimensional-array construction support. Source custom implementations retain
their explicit diagnostics. The pinned capture and its hash stay unchanged;
ordinary tests never launch the .NET toolchain.

Native implementation references:
- [StringComparer object comparisons](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/StringComparer.cs)
- [Array non-generic binary search](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Array.cs)

Default culture-sensitive comparison and arbitrary managed comparison callbacks
remain tracked by #829 and #2655 respectively. This corpus qualifies the explicit
ordinal/primitive profile, not arbitrary culture collation.
