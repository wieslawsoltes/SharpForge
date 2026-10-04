# StringComparer.FromComparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringComparerFromComparison.csproj --configuration Release -- ../string-comparer-from-comparison-net10.json
```

The bounded capture records all six enum modes and four invalid extremes under
invariant and tr-TR current cultures. It pins factory/getter/repeated reference
identity, nullable and difficult Unicode comparison signs, List.Sort and
non-generic Array.BinarySearch outputs, exception types and parameter names.
Malformed UTF-16 is serialized as unit arrays. Source SHA-256 freezes the program.

Culture outputs remain native evidence. SharpForge supports this factory only
for Ordinal and OrdinalIgnoreCase; valid culture modes explicitly fail until
the culture backend is available. No culture parity is inferred from this capture.
