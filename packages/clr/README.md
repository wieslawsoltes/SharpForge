# CLR assembly resolution services

This package supplies explicit, offline assembly identity and asset-selection
services. It does not yet load CLR types or execute assemblies.

`AssemblyName.parse(displayName)` parses immutable partial identities, preserving
unspecified components as `null`. `fullName` formats CLR quoting and escaping.
`normalizeAssemblyIdentity` asynchronously derives full-key tokens using Web
Crypto. Syntax failures produce `AssemblyLoadError` with a stable `SFCLR` code,
managed exception type, requesting assembly and deterministic `fusionLog`.
Malformed cultures and empty names currently use the loader's FileLoadException
contract, rather than .NET's more specific argument/culture exception types.
Culture names use the host's BCP 47 canonicalization; legacy ICU-specific names
outside that format are explicitly rejected.

`assemblyIdentityFromRow` consumes decoded ECMA Assembly/AssemblyRef rows and
host-provided string/blob readers. `compareAssemblyIdentity` classifies name,
culture, token, content-type and version mismatches. Retargetable metadata never
silently bypasses key checks. `exact`, `higher` and `roll-forward` policies are
explicit; roll-forward bounds can be patch, minor or major.

`AssemblyProvider(name, entries)` indexes a finite host-supplied set of identities.
`AssemblyResolver` checks providers in declared order and chooses the highest
compatible version in the first matching provider. Duplicate candidates at that
version are errors. Its bounded cache, abort signals and idempotent disposal keep
lifetime and resource use explicit. No network or filesystem discovery occurs.
See `node packages/clr/examples/resolve.js` for a runnable example.

`readDependencyManifest` interprets deps/runtimeconfig data into trusted assembly
paths, RID fallback order and configuration. It does not open those paths or
resolve shared frameworks on the host. `selectNugetAssets` selects compile or
runtime assets from an already-extracted package path list; `assetsFromProject`
reads restore's decisions directly. Supported TFM families are netstandard,
netcoreapp and net5+. Unknown families are diagnostics. Restore, archive decoding
and downloading remain separate responsibilities.

| Capability | Current evidence |
| --- | --- |
| Assembly display-name grammar | 162 native .NET 10.0.5 cases retained; JS comparison not yet run |
| Public key tokens and row adapter | ECMA known-key regression authored; Microsoft-key/native metadata qualification pending |
| Ordered offline resolver | Positive, mismatch, ambiguity, cancellation and disposal regressions authored; not yet run |
| deps/runtimeconfig and RID fallback | Fixture regressions authored; published-app host-trace comparison pending |
| NuGet asset selection | Fixture regressions authored; native 30-package selection matrix pending |
| Execution targets | Host JavaScript services only; source VM, direct CIL, Rust native and Rust Wasm integration pending |

Reference grammar: [.NET v10.0.5 AssemblyNameParser](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/Common/src/System/Reflection/AssemblyNameParser.cs).
Metadata identity: ECMA-335 6th edition, II.22.2 and II.22.5.
Native naming fixture source and inputs are in `tests/fixtures/clr-identity/`.
All validation is deferred until the complete T01 scope is ready.
