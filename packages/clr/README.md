# CLR assembly resolution services

This package supplies explicit, offline assembly identity and asset-selection
services. [Assembly load contexts](CONTEXTS.md) add lazy metadata loading and
explicit lifetimes. Full CLR type construction and execution are separate work.
Canonical [method definition identities](METHODS.md) retain lazy signature and
body access for reflection and execution services to consume later.
Canonical [field definition metadata](FIELDS.md) adds lazy field signatures and raw constants.
Canonical [property metadata](PROPERTIES.md) adds index signatures and accessor method links.
Canonical [event metadata](EVENTS.md) adds raw event-type tokens and add/remove/raise method links.
Bounded AST [generic signature substitution](GENERICS.md) preserves metadata
tokens and open caller scopes without parsing display names.
[Prepared CIL core authority](VERIFICATION-CORE-TYPES.md) binds an explicit token
selection through the loader for synchronous verification category queries.

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
reads restore's decisions directly. `selectNugetPackage` reads an in-memory nupkg
through the existing bounded archive package and returns selected asset bytes.
Supported TFM families are netstandard, netcoreapp and net5+. Unknown families are
diagnostics. Restore and downloading remain separate responsibilities.

| Capability | Current evidence |
| --- | --- |
| Assembly display-name grammar | 162 native .NET 10.0.5 cases pass JavaScript differential comparison |
| Public key tokens and row adapter | ECMA known key and three native Microsoft keys pass; row shape/malformed token regressions pass |
| Ordered offline resolver | Positive, mismatch, ambiguity, cancellation and disposal regressions pass |
| deps/runtimeconfig and RID fallback | Application paths match native `dotnet exec --depsfile` host trace; RID/cycle regressions pass |
| NuGet asset selection | 30 fixture package layouts match native NuGet FrameworkReducer; in-memory archive selection passes |
| Execution targets | Host JavaScript services only; source VM, direct CIL, Rust native and Rust Wasm integration pending |

Reference grammar: [.NET v10.0.5 AssemblyNameParser](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/Common/src/System/Reflection/AssemblyNameParser.cs).
Metadata identity: ECMA-335 6th edition, II.22.2 and II.22.5.
Native fixture source and inputs are in `tests/fixtures/clr-identity/`. Capture
with `node packages/clr/tools/capture-reference.mjs artifacts/clr-reference`;
the harness uses the installed SDK's NuGet assembly and disables all package
sources. These fixtures qualify identity/selection rules, not execution of
third-party assemblies. Run the retained offline comparison with
`node --test --test-concurrency=1 tests/clr-identity-*.test.js`.

The first implementation has no previous CLR resolver benchmark baseline.
`node --expose-gc packages/clr/tools/benchmark-identity.mjs` measured 10,000
provider entries on Apple M3 Pro, Node 24.21.0, darwin-arm64:

| Operation | Median µs | p95 µs | p99 µs |
| --- | ---: | ---: | ---: |
| Parse display name | 2.458 | 9.546 | 16.075 |
| Cold indexed resolution | 2.590 | 11.703 | 36.027 |
| Cached indexed resolution | 0.732 | 3.544 | 5.532 |

The benchmark also records retained heap deltas; it does not claim exact
allocation counts or an unmeasured speedup. Results vary by host and load.
