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
[Canonical generic instantiation](INSTANTIATION.md) binds ordered type handles,
resolves scoped TypeSpecs and completes substituted base/interface graphs with
explicit constraint and execution boundaries.
[Prepared CIL core authority](VERIFICATION-CORE-TYPES.md) binds an explicit token
selection through the loader for synchronous verification category queries.
[Manifest resource readers](MANIFEST-RESOURCES.md) expose bounded embedded,
linked-file and AssemblyRef resource bytes with explicit host input and hash verification.
[ExportedType forwarding](FORWARDERS.md) resolves facade and nested exported
names to canonical definitions with bounded chains and explicit cycle errors.
[Binary resource inspection](RESOURCES.md) reads bounded `.resources` v2 name
tables and typed values while preserving serialized user data as opaque bytes.

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
| Canonical generic type metadata | [Identity, scoped binding, finite closure and current qualification](INSTANTIATION.md#current-qualification) |
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

## Canonical assembly usage relationships

`await createAssemblyMethodRelations(module, options)` creates an immutable local-module
snapshot for `new AssemblyUsageAnalysis(inspector, { methodRelations: snapshot })` in
`@sharpforge/cil`. Pass a `RuntimeModule` from an explicitly configured load context;
the inspector must represent the same MVID and metadata extents. This preserves the
existing dependency direction: CIL does not import CLR or infer virtual slots.

`overridden-by` records every local overridden ancestor declaration, using the existing
canonical `MethodDesc.getBaseDefinition()` service. `newslot` declarations start distinct
families. `implemented-by` records each local interface declaration's canonical method
and implementing type. Interface maps support public virtual instance methods, exact
MethodDef/MemberRef `MethodImpl` aliases, inheritance, explicit implementation and interface
reimplementation. An inherited interface map follows overrides of its existing virtual
slot; a same-name `newslot` method alone does not replace that mapping. Reimplementation
can select a method declared on the current type. Without such a declaration, an existing
inherited mapping takes precedence over older public methods, including when the mapping
uses an explicit implementation. A newly introduced interface can use ancestral public
methods when no inherited entry exists. Signatures and
generic method constraints reuse `OverrideSignatures`; display names never establish
type identity or slot compatibility.

The analysis reads metadata without executing IL or requesting method bodies. Snapshots
contain only strings, numbers and frozen arrays/records, so they remain usable after a
collectible context is unloaded. Instruction-body completeness and the two declaration
relations' completeness are reported independently by the CIL query API. The relation
snapshot is scoped to methods and implementing types defined in the supplied module;
external declarations are outside its query domain. References needed to establish a
local relationship still resolve through the configured CLR context.

Unsupported binding produces a stable per-relation diagnostic. This includes generic
declaring types/constructed interface slots, default and reabstracted interface fallback,
static virtual interface slots, class `MethodImpl`/covariant replacement, and canonical
base-definition forms unsupported by the existing service. MemberRef bodies are resolved
for interface maps; the current base-definition service can still diagnose them separately.
Malformed metadata rejects with `SFCLR005`; invalid options, exhausted budgets and
cancellation reject with `SFCLR006`, `SFCLR007` and `SFCLR009`. No unsupported relationship
is silently converted into an empty complete answer. Issue #2573 remains open for the
remaining slot families and wider platform qualification.

Options lower these independent hard maxima: `maxMetadataRows:100000`, `maxMethods:16384`,
`maxRelations:100000`, `maxDiagnostics:16384`, `maxDepth:128`, `maxMetadataBytes:8388608`,
and `maxWork:1000000`, plus `signal`. Relevant row counts, per-method/MemberRef signatures
and names are preflighted before the adapter builds indexes. Each name/signature occurrence
is bounded to 4096 input bytes; `maxMetadataBytes` counts twice the decoded name character
count plus signature byte lengths. `snapshot.storage` reports logical preflight/work
counts, not retained JavaScript heap size. Context/type loading and canonical base-root
resolution retain their own independent limits; the adapter's work counter does not claim
to count their internal steps.

The adapter indexes names plus canonical signatures and MethodImpl owners once, then
uses constant-time slot lookups along bounded ancestor chains. Its added work is linear
in metadata payload and visited maps/ancestor edges, plus emitted relationships; the
underlying CLR resolver's cost is separate. Queries page prebuilt CIL indexes without
reloading metadata. No benchmark was run for this batch; logical storage counters
and test durations do not establish allocation cost or a speedup.

Reference: [ECMA-335 II.10.3/II.12.2](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf)
and [.NET's interface-method specification addendum](https://github.com/dotnet/runtime/blob/main/docs/design/specs/Ecma-335-Augments.md).
The [declaration fixture](../../tests/fixtures/declaration-relations/README.md) retains
33 passing focused Node tests and exact comparison with 19 native
`GetBaseDefinition`/`GetInterfaceMap` relationships on CoreCLR 10.0.5. It records the
interface reimplementation correction, source hashes and full reference configuration.
The browser harness is prepared but has no successful launch or passing result;
browser and wider execution-platform qualification remain pending.
