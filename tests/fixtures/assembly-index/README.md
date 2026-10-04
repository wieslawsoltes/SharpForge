# Cross-assembly definition index

Implementation-ready #2571 batch based on main
`bf5ed78110a864d9771849ac7845f0139d1986c4`. No install, test, benchmark, browser or
static check has run for this branch; the root schedules the sole validation slot.

Seven prepared tests cover 20 loaded assemblies/20,120 definitions, stable MVID/token
IDs across reload, bounded logical UTF-16 payload/count accounting, all five definition
kinds, nested types, MethodPtr ownership, immutable snapshots, no signature/body
reads, exact/limit-minus-one boundaries, cancellation, duplicate identities/ownership,
raw token aliases and empty/end/zero pages. Existing inspector navigation fixture
provenance is reused: `portable-pdb-unnamed-slots` records Roslyn 5.3, SDK 10.0.201,
CoreCLR 10.0.5 Release method names/tokens and the retained PE SHA-256. This is
inspection evidence; native assembly execution is not part of this API.

At the granted slot: one candidate install, new focused tests plus existing inspector
navigation/consumer compatibility; one fixed existing-constructor control and new
index measurements with retained chronological data; one shared focused browser
round with 20-module/reload/budget/ownership checks; static/manifests/structure.
No new native build or broad Studio/cross-platform matrix is required for this scope.

The index snapshots existing loaded metadata definitions, not arbitrary referenced
or constructed types. No assembly resolver, search or usage analysis is added.
Budgets count definitions and logical scalar/string payload; engine object/map/array
overhead and the already-loaded inspectors are not represented as a hard heap limit.
No measured speed, allocation, memory or untested-platform claim is made.
