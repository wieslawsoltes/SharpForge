# Framework and runtime contexts

The public framework helpers accept NuGet-style target framework monikers for
.NET Framework, .NET Standard, .NET Core and modern .NET, including platform
suffixes. `parseTargetFramework(value)` returns `original`, `supported`,
`identifier`, `version`, `platform` and `platformVersion`. An unknown moniker is
explicitly unsupported. `isTargetFrameworkCompatible(target, candidate)` and
`nearestTargetFramework(target, candidates)` apply the supported framework and
platform compatibility rules; a missing compatible candidate returns `null`.

`targetFrameworkDefines(value)` produces deterministic framework/platform
symbols. It rejects a major version above 100 before generating a large symbol
set. These helpers do not choose an installed SDK or restore a package.

`projectContextId({project, configuration, platform, targetFramework,
runtimeIdentifier})` serializes the ordered dimensions into one stable ID.
Configuration and platform default to `Debug` and `AnyCPU`; target framework and
runtime identifier default to empty strings. The `path` key is a compatibility
alias for `project`.

`ProjectContextSelection` retains independent context records and one active ID
per project. `update(contexts)` replaces all previous contexts for the projects
present in the new records, preserving an active ID only when it remains valid.
`select(project, selector)` accepts an ID or a subset of the four configuration,
platform, framework and runtime dimensions. Dimension comparisons are case
insensitive. An unavailable context throws `SFP1903`. `get(project)` returns the
active record or `null`; `diagnostics()` returns current context diagnostics;
`clear()` removes the store. `findProjectContext` exposes the same pure matching
rule.

`resolveProjectReferenceContext(source, dependency, reference)` selects the
nearest compatible dependency framework, then the matching runtime or a
runtime-neutral context. Explicit `TargetFramework`, `SetTargetFramework` or
`AdditionalProperties` metadata takes precedence. No compatible context throws
`SFP1904`. These are context-selection contracts over supplied records. Loading
and reevaluating separate project snapshots is implemented by the evaluator
batch that consumes them.

`runtimeFallbacks(rid, graph)` expands imports in NuGet breadth-first order. The
default immutable `PORTABLE_RUNTIME_GRAPH` contains the 85 portable identifiers
from the SDK version and SHA-256 recorded in `PORTABLE_RUNTIME_GRAPH_SOURCE`.
An unknown root returns an error diagnostic with code `NETSDK1083` and no
fallback candidates. A caller may provide an explicit graph instead.

`readRuntimeGraph(runtimeJson)` accepts JSON text or its parsed object, copies
the `runtimes`/`#import` records, and freezes the resulting table. Invalid data or
cycles throw `SFP1910`. Source text is bounded to 4 MiB, identifiers to 256
characters, nodes to 20,000 and imports to 100,000. Traversal and cycle detection
use iterative O(V + E) algorithms.

`resolveRuntimeIdentifiers(properties, {graph})` reads `RuntimeIdentifier` and
`RuntimeIdentifiers` case insensitively. It returns the explicit selected value,
unique declared identifiers, per-identifier fallback chains and diagnostics.
It retains an empty selected RID when the project only declares alternatives.
Declarations are bounded to 65,536 characters and 256 entries.
