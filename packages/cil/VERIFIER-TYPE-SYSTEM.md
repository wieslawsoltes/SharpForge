# Metadata verification type relations

`createMetadataVerificationTypeSystem(inspector, options)` snapshots the local,
non-generic TypeDef hierarchy of one `AssemblyInspector`. It introduces no work
in existing inspection, execution or merge callers until explicitly requested.
Its frozen canonical identities are scoped to that adapter, never matched by
names or raw tokens across assemblies. The inspector can be released after
construction; retained facts contain no PE views, descriptors or signature ASTs.

Queries return frozen `{status: 'known', value}` or
`{status: 'unknown', reason, token}` results:

- `resolveType(token)` resolves local non-generic TypeDefs and explicit
  Module-scoped TypeRefs whose namespace/name uniquely names a top-level local
  definition. Nested TypeRef scopes also resolve when their enclosing chain
  is anchored in that explicit local Module and every enclosing definition
  is non-generic. All aliases share the existing canonical TypeDef result
  and identity. Nil, ModuleRef and AssemblyRef scopes remain unknown, as do
  TypeSpecs, generic definitions and nested references through generic scopes.
- `baseType(type)` resolves the declared direct base; a missing base is known
  `null`. `interfaces(type)` returns a frozen array of results for the direct
  InterfaceImpl edges, preserving unknown entries.
- `isAssignable(source, target)` checks identity and local class/interface
  ancestry, including inherited interfaces. Missing ancestors yield unknown
  unless a local path proves the assignment. Interface-to-class assignment
  requires the unresolved core-library Object identity and is unknown.
- `commonBaseType(left, right)` finds the closest shared local class ancestor.
  Interface joins and absent/unresolved common ancestors are unknown.
- `relations` implements the existing `mergeVerificationTypes` relation seam;
  unknown results throw `CILV0003`. Distinct managed-pointer elements need
  normalization and are unknown; reference covariance is never used for them.

Only adapter-issued identities are valid inputs; cloned or foreign identities
throw `CILVT0004`. Nominal verification categories remain the caller's explicit
responsibility. Never wrap an unknown result in `verificationType` as though it
were an identity. This service reports metadata hierarchy facts, not whole-type
validity or whole-method verification. Value/enum normalization, arrays, generic
substitution, external assembly loading, member resolution and access queries
remain open on #2400 and subsequent verifier tasks. No runtime engine is enabled
by this opt-in metadata API; browser/native/Wasm qualification remains staged.

Local-reference lookup indexes exact namespace/name UTF-8 bytes during
construction; it never joins display names or uses Unicode normalization.
The top-level index excludes the global module type and nested definitions.
Nested names use a separate enclosing-TypeDef key and the validated existing
NestedClass forest; no display-name concatenation determines ownership.
Ambiguous and missing names remain `unresolved-type-reference`; generic targets remain
`generic-definition`. Alias edges are normalized before local cycle and
class/interface-kind validation. Only numeric aliases survive construction,
so the temporary name index does not become another identity registry. The
combined member context reuses the same validated lexical forest for access
checks through an internal composition seam; no new package export is added.

Construction snapshots and cycle-checks O(types + references + edges + generic
parameters + nested rows + indexed name bytes) facts. Each hierarchy
query is O(reachable types + edges), with no persistent pair cache. Defaults and
hard maxima are 65,535 TypeDefs, 65,535 TypeRefs, 65,535 total type/InterfaceImpl
rows, 65,535 GenericParam rows, 1 MiB of unique indexed heap-name bytes, 4,096
visited query nodes and depth 256. Each indexed name/namespace is limited to
1 KiB. The name index is constructed only when an explicit local Module scope
is present. Nested indexes are built only when a local nested reference needs
them. TypeRef scope chains use iterative memoization, reject cycles, and are
bounded by `min(maxDepth, 64)` nested edges; NestedClass forests retain their
64-level ceiling and cannot contain more rows than TypeDefs.
Options `maxTypes`, `maxTypeReferences`, `maxTypeNameBytes`,
`maxEdges`, `maxQueryNodes`, `maxDepth` may lower these limits; `signal` cancels
construction and queries. These limits cover the adapter, not earlier inspector
construction. Malformed local hierarchy/token data throws `CILVT0001`, budget
failures `CILVT0002`, cancellation `CILVT0003`.

Tests use real metadata reader/inspector seams with synthetic hierarchy graphs;
arbitrary baseless graph nodes are not claimed to be native-loadable types.


## Focused evidence

At product commit `a15e209f`, 28/28 focused tests passed: the two type-system
files, existing verification types, signatures and signature compatibility.
Pinned Roslyn SDK 10.0.201 / CoreCLR 10.0.5 produced 36 reflection comparisons:
all 16 known adapter results agreed, while 20 external/interface-root dependent
relations remained explicitly unknown. The capture retains the assembly,
source/compiler/reference hashes, native output and tool versions in
`tests/fixtures/a03-verifier-types/native.json`. Reproduce with
`node scripts/limited.js node tests/fixtures/a03-verifier-types/capture.mjs /tmp/verifier-types-native.json`.
This is metadata relation evidence, not full verifier or cross-platform qualification.

On shared Apple M3 Pro / macOS 26.6 / Node 24.21.0, the opt-in benchmark measured
1,000 adapter constructions at median/p95 **8.103958 / 12.356750 ms** and 1,000
inherited-interface queries at **0.366833 / 2.018709 ms**. These are batch timings
for the retained 11-TypeDef synthetic fixture, not individual latency percentiles
or a speedup comparison. No existing API path was changed. All 12 chronological
samples per mode (first three warmups) and heap observations are retained in
`benchmarks/verifier-type-system-node24.json`; heap deltas are neither allocation
volume nor peak memory. Reproduce with
`node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-verifier-types.mjs /tmp/verifier-types-benchmark.json`.

Validation used one limiter reservation and serial child commands with test
concurrency 1 and a 1,024 MiB Node heap cap. Static checks passed 3,091 syntax /
3,087 import modules; manifests covered 30 areas with no unassigned/duplicate
files. Structure reported 268 existing findings and none in changed files.
Browser, source/direct-CIL execution and native/Wasm engine qualification remain
staged; this feature does not execute methods in those engines.

The nested local-reference batch adds 85/85 focused/affected tests and pinned
CoreCLR observations for 25 TypeRefs, including 12 supported nested/top-level
aliases with canonical identity agreement. Its [retained qualification](../../tests/fixtures/a03-nested-type-references/README.md)
records the isolated baseline, original fixture/test failures, all 96 timing
samples and explicit acceptance of the existing local-alias construction cost.
