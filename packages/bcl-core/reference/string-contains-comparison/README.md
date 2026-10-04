# String Contains comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringContainsComparison.csproj --configuration Release -- ../string-contains-comparison-net10.json
```

The capture records exact UTF-16 inputs, results, exception types, parameter
names and reference identity for Contains(string, StringComparison). It covers
positions, overlaps, empty/longer needles, Unicode casing, NUL, malformed UTF-16,
substring boundaries through surrogate pairs, and repeated-prefix misses/hits.
The precedence matrix combines nulls and shortcut inputs with valid/invalid modes.

CurrentCulture is pinned to InvariantCulture for native culture controls. Their
real results remain unchanged; SharpForge explicitly rejects modes 0–3 after
receiver/value null validation, before identity/empty/length shortcuts. Tests
assert this profile difference separately. IndexOf, range search and culture
search support remain outside this batch.
