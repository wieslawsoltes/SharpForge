# Portable project evaluation

`ProjectSystem(files, options)` owns one explicit workspace evaluation session.
The public package entry remains compatible; the formatted session class lives in
`project-system.js` so future behavior does not grow the frozen entry module.
Inputs may be file records or a Map. Text, byte records and valid metadata-only
`{ lazy: true, size }` records are distinct. Missing Compile contents must be
hydrated before source collection and are never replaced with empty strings.

## Ordered phases

`load(entry)` reads a project, classic solution or `.slnx`, evaluates project
references and returns a snapshot. Evaluation has explicit property/import,
item-definition, item and result phases. Local imports, wildcard imports,
ImportGroup, Choose, Directory.Build props/targets and Directory.Packages props
are processed with defining-file provenance. Global properties remain immutable
unless declared in TreatAsLocalProperty; reserved file/project properties cannot
be overwritten by project XML. Environment values come only from options.

Item evaluation supports generic item types, Include/Exclude/Remove/Update,
definitions, metadata, transforms and batching conditions. File items retain
normalized paths; logical Using and package items retain identities without fake
file paths. Item copy operations preserve metadata and defining-project data.
Central PackageVersion values, VersionOverride and GlobalPackageReference are
resolved into package references; invalid central declarations keep their
NU1008/NU1010 diagnostics. Package restore and package assembly acquisition remain
native operations and unresolved package references retain SFP1102.

Bundled data models cover Microsoft.NET.Sdk and named Web/Worker/Razor/test/
traversal variants. They model properties, default items, framework/configuration
defines, generated global usings and assembly-info metadata. They do not replace
the installed SDK's complete task implementations. Unknown SDK identities fail
with SFP1004. Synchronous caller sdkResolvers may return explicit props/targets/
items phase handlers; asynchronous or native acquisition must finish before
evaluation. SDK imports and regular imports remain distinct in snapshot data.

Generated sources include provenance, kind and structured assemblyAttributes.
Assembly-emission hosts must retain those attributes. Resource naming/conversion
and launch profile data use their existing public contracts. Analysis reads the
model; compilation and target execution are separate phases.

## Framework and runtime contexts

Multi-target projects first discover declared frameworks, then evaluate each
inner build with independent properties, items, diagnostics and generated data.
Each context has a stable project/configuration/platform/TFM/RID ID. The active
project snapshot additionally exposes all contexts. Runtime fallback chains use
the shared pinned graph and unsupported identifiers retain NETSDK1083 diagnostics.

`getContext(path, selector?)` returns the selected context, a matching stable ID,
or a match for explicit dimensions. It returns `null` when no context matches.
`selectContext(path, selector)` validates the
selection and re-evaluates the loaded workspace; stale IDs are not retained after
configuration changes. `options.projectProperties[path]` overlays the relevant
project's global configuration, platform and framework values.

`snapshot()` returns solution/projects/diagnostics plus configuration/platform.
Classic unsupported project types remain visible as unloaded placeholders with a
reason; they do not enter portable C# compilation membership. Project cycles,
missing input, invalid expressions, native-only constructs and budget exhaustion
remain explicit diagnostics. Defaults bound 5,000 files, 100 projects, 32 target
frameworks, 256 imports, import/reference nesting and 1,000,000 evaluation steps.
Cancellation is checked during evaluation through options.signal (SFP1099).

## Hydration and compatibility source collection

`evaluationInputs()` discovers resource files, dependent source and resx file
references. Repeat after resx hydration to discover further inputs. `buildFile`
reads exact-context virtual outputs with workspace fallback. `setBuildFile`
requires actual text or bytes and replaces metadata-only records; it does not
grant filesystem access. The host owns reads, cancellation and publication guards.

`compilationFiles(startup, options)` retains the existing source-combined preview
contract. It refuses lazy Compile input and includes generated global usings.
Assembly-info sources require an assembly-emission host; callers may explicitly
include them, and omission emits SFP1405. `compilationOptions(startup)` retains
per-source policies and rejects linked-source conflicts. These compatibility
helpers do not execute targets or provide assembly isolation. `runOptions`
returns the modeled launch request for the selected project.

Target graph classification is exposed through createTargetGraph/classifyTask;
loading never executes tasks. Portable task scheduling and dependency-ordered,
assembly-isolated build plans are separate dependent feature batches. No target
execution or build-plan method is stubbed in this evaluator-only projection.

The focused scope preserves the original expression/item/central-package and SDK
model assertions. SDK compiler/source-VM/direct-CIL execution assertions remain
intact in the separate execution qualification file and are run with that host
scope. This distinction avoids implying compiler/runtime parity from model tests.
