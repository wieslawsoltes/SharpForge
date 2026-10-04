# Culture ordering boundary reference

Run from this directory with SDK 10.0.201 and runtime 10.0.5 installed:

```sh
dotnet run --project CultureOrderingBoundaries.csproj --configuration Release -- ../culture-ordering-boundaries-net10.json
```

This independent fixture supplements the unchanged 97-value culture-ordering
oracle. It captures canonical combining-mark reordering, composed/decomposed
text, same-class combining marks, ignorables, UTF-16 surrogates, width and kana.
The reference records source hash, runtime, OS and SortVersion provenance.

The host probe reports all 9,409 original pair comparisons plus both directions
of these boundary pairs. A mismatch remains visible in its JSON output and exit
status; it must not be repaired by substituting host results into this oracle.
Host Intl normalization and collation data can differ from native .NET ICU.

The initial serial probe on Node 24.21.0, V8 13.6.233.17-node.53 and ICU 78.3
(CLDR 48.0, Unicode 17.0) matched all 9,409 original comparisons. Five boundary
pairs differed: reordered acute/cedilla, reordered comma/grave, composed
acute/cedilla, composed dot/below and reordered Hebrew marks. Intl compares each
pair as equal while the captured native default distinguishes them. Both
directions remain in the probe report; an exit status of 1 is expected while
these ten directional mismatches remain. This finite result does not qualify
other ICU versions or establish full .NET parity. Issues #829/#2619/#2621 stay open.

The provider requests English standard collation because
[CLDR English inherits root collation](https://raw.githubusercontent.com/unicode-org/cldr/release-47/common/collation/en.xml).
Requesting `und` can fall back to the host's default locale under
[ECMA-402 locale resolution](https://tc39.es/ecma402/#sec-resolvelocale).
[V8 enables normalization](https://github.com/v8/v8/blob/main/src/objects/js-collator.cc),
whereas [.NET's default ICU handle](https://github.com/dotnet/runtime/blob/v10.0.5/src/native/libs/System.Globalization.Native/pal_collation.c)
uses the locale's unmodified comparison attributes. The host-backed profile
therefore cannot stand in for an exact native CompareOptions.None backend.
