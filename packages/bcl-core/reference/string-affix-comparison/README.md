# String affix comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringAffixComparison.csproj --configuration Release -- ../string-affix-comparison-net10.json
```

The 264-row native capture records StartsWith/EndsWith with StringComparison,
including exact UTF-16 units, results, exceptions, parameter names and identity.
It covers empty/longer affixes, Unicode casing, NUL, malformed surrogates and
prefix/suffix boundaries that split surrogate pairs near 8/16/32-unit scan widths.
The fault matrix includes null receiver/value, invalid modes and shortcut inputs.

CurrentCulture is pinned to InvariantCulture for the native culture controls.
Their real results remain unchanged. SharpForge deliberately rejects modes 0–3
after receiver/value null validation, before identity/empty/length shortcuts.
Tests assert this explicit profile difference separately; culture support and
other comparison overloads remain outside this batch.
