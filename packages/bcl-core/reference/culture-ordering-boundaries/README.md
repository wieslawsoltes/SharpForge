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
