# Metadata verification type relations

`createMetadataVerificationTypeSystem(inspector, options)` snapshots the local,
non-generic TypeDef hierarchy of one `AssemblyInspector`. It introduces no work
in existing inspection, execution or merge callers until explicitly requested.
Its frozen canonical identities are scoped to that adapter, never matched by
names or raw tokens across assemblies. The inspector can be released after
construction; retained facts contain no PE views, descriptors or signature ASTs.

Queries return frozen `{status: 'known', value}` or
`{status: 'unknown', reason, token}` results:

- `resolveType(token)` resolves local non-generic TypeDefs. TypeRefs (including
  module-local references), TypeSpecs and open generic definitions are unknown.
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

Construction snapshots and cycle-checks O(types + edges) facts. Each hierarchy
query is O(reachable types + edges), with no persistent pair cache. Defaults and
hard maxima are 65,535 TypeDefs, 65,535 total type/InterfaceImpl rows, 65,535
GenericParam rows, 4,096 visited query nodes and depth 256. Options `maxTypes`,
`maxEdges`, `maxQueryNodes`, `maxDepth` may lower these limits; `signal` cancels
construction and queries. These limits cover the adapter, not earlier inspector
construction. Malformed local hierarchy/token data throws `CILVT0001`, budget
failures `CILVT0002`, cancellation `CILVT0003`.

Tests use real metadata reader/inspector seams with synthetic hierarchy graphs;
arbitrary baseless graph nodes are not claimed to be native-loadable types.
