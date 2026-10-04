# Double formatting reference

Capture the fifty named binary64 values using SDK 10.0.201 and CoreCLR 10.0.5:

```sh
cd packages/bcl-core/reference/double-format
dotnet run --project DoubleFormat.csproj --configuration Release --verbosity quiet > ../double-format-net10.json
```

The SDK is pinned by `global.json`; the project and program reject a different
runtime. Values are recorded as hexadecimal IEEE 754 bits so the regression
fixture preserves negative zero, subnormal values, infinities and NaN. Every
value records the five required formats and their lowercase/zero-precision
variants with invariant culture. This fixture measures actual .NET formatting;
the JavaScript tests execute the same bits on each supported engine separately.
