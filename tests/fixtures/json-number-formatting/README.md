# JSON binary64 formatting reference

This fixture uses SDK 10.0.201 and runtime 10.0.5, pinned without roll-forward.
It reuses the fifty exact binary64 bit patterns captured for default formatting,
and captures native JsonSerializer scalar, mixed-array and dictionary output.

From this directory:

```sh
dotnet run --project JsonNumberFormatting.csproj --configuration Release --verbosity quiet -- ../../../packages/bcl-core/reference/double-format-net10.json > oracle.json
```

The oracle also records native nonfinite failures. SharpForge retains its
existing `JsonException` policy for nonfinite values; this numeric spelling fix
does not normalize exception categories or source/CIL boolean boxing.
