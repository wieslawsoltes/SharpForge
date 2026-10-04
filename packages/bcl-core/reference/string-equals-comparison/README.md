# String.Equals comparison reference

Run serially from this directory with SDK 10.0.201 and runtime 10.0.5:

```sh
dotnet run --project StringEqualsComparison.csproj --configuration Release -- ../string-equals-comparison-net10.json
```

The capture retains native results, exception types, parameter names and UTF-16
units for static and instance overloads. It covers Ordinal/OrdinalIgnoreCase,
identity and separately allocated equal strings, null receivers/arguments, invalid
enum values before shortcuts, casing, normalization, NUL and malformed surrogates.
CurrentCulture is pinned to InvariantCulture for the native culture-mode controls.

Culture-mode rows retain their real .NET results. SharpForge deliberately rejects
modes 0–3 with NotSupportedException (except a null instance receiver, which fails
first with NullReferenceException); tests state that profile difference separately.
The capture does not qualify culture support, comparer equality/hash or factories.
