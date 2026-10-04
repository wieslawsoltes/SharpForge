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

Root captures once, with build output separate from the JSON artifact:

```sh
dotnet build OrdinalIgnoreCase.csproj --configuration Release --verbosity quiet
dotnet bin/Release/net10.0/OrdinalIgnoreCase.dll ../ordinal-ignore-case-net10.json
```

Ordinary tests read the committed output without native execution. This evidence
qualifies the captured runtime/OS; it does not establish other culture comparers
or all-platform globalization parity.
