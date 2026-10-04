# Workbench project compiler composition

`createWorkbenchServices({requestCompiler})` supplies an optional project compiler
contribution. Each operation receives its project ID, method, explicit parameters,
cancellation options, revision and a raw worker request port. `BuildService` retains
request generations and rejects results after source/configuration invalidation.

`StudioProjectCompiler` pins a requested project without selecting it in the UI.
The existing portable graph runner owns target order and artifact reuse. Complete
graph operations share a scheduling tail because their virtual outputs belong to
one project system; cancelled or retired workspace requests fail before compilation.
Native context inputs retain their existing public preparation contract.

`StudioProjects` invalidates reverse dependencies, passes verified emitted dependency
envelopes into launch, and preserves explicit workbench argument/environment
precedence over project defaults. Loading diagnostics belong to the selected target
framework; untagged project/solution diagnostics remain visible. Diagnostics from an
inactive framework neither duplicate nor block the active project service.

The seven direct project-composition cases and five diagnostic-producer cases run
through public workbench/project APIs. The source is projected exactly from
`7b087e0f0e3105c71ec86e39554358766b45d3bf`; root owns its consolidated qualification.
The protected Studio entry is a separate text-only proposal. This module-level
contract does not claim actual full-Studio, Windows target or browser execution.

`projectRuntimeDependencies(result)` rejects failed, missing, empty, oversized or
over-budget PE artifact envelopes before worker transport. It preserves dependency
byte-array identity and project/context provenance and omits the entry artifact,
analysis graphs, PDBs and resource graphs. Three existing focused boundary cases
qualify this canonical transport adapter; it consumes public bytecode limits.
