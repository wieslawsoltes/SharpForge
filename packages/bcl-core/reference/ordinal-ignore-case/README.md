# OrdinalIgnoreCase reference

The fixture pins SDK 10.0.201 and runtime 10.0.5. It examines every Unicode
scalar and isolated UTF-16 surrogate against its invariant uppercase mapping,
both alone and beside ASCII prefixes/suffixes. Changed mappings and measured
comparison signs are retained; omitted points are unchanged by invariant casing.
The existing complete simple-uppercase capture is reused, not regenerated.

A nullable string matrix adds ASCII/non-ASCII boundaries, dotless/dotted I,
long s, Kelvin sign, sharp s versus SS, Greek mappings, supplementary case pairs,
Garay invariant/ordinal mapping differences, embedded NUL and malformed
surrogate sequences. Separate native rows capture
List.Sort, non-generic Array.BinarySearch, object comparison/fault wrapping and
singleton identity. Strings use UTF-16 integer arrays to retain isolated surrogates.

The capture contains 83 values (6,889 ordered pairs) and 1,504 changed invariant
uppercase relations. All but 26 relations compare equal: U+017F and the 25 Garay
lowercase letters U+16EBB–U+16ED3 retain distinct ordinal identity. Their ASCII
prefix/suffix forms agree. The matrix also distinguishes scalar ordering of
complete supplementary pairs from the UTF-16 order of StringComparer.Ordinal.

Root captures once, with build output separate from the JSON artifact:

```sh
dotnet build OrdinalIgnoreCase.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/OrdinalIgnoreCase.dll ../ordinal-ignore-case-net10.json
```

Ordinary tests read the committed output without native execution. This evidence
qualifies the captured runtime/OS; it does not establish other culture comparers
or all-platform globalization parity.
