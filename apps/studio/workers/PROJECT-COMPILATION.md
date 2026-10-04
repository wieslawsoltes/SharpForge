# Project compilation worker contract

`compileProjectPlan(plan, {compileUnit, extensions})` consumes a dependency-ordered
project plan and returns diagnostics plus separate emitted project artifacts.
Project source remains in its own compilation; references carry the prior
assembly bytes and their aliases. `ReferenceOutputAssembly=false` retains the
build dependency while excluding its bytes from compilation references.

A plan identifies `startup` and optional `startupContextId`. Every unit provides
`project`, optional `contextId`, `assemblyName`, `output`, `sources`, `references`,
compiler `options`, and optional external `metadataReferences`, `resources`, and
structured `assemblyAttributes`. A context ID defaults to the project path.
Each source contains `uri` or `path`, text, and an optional document version.

`dependencyArtifacts` seeds a later request with successful earlier outputs.
Each seed needs a unique context ID, project, nonempty `Uint8Array` assembly,
`success: true`, and `runtimeProfile: 'sharpforge'`. Seeds and units share a limit
of 512 contexts; seed assembly bytes share a 128 MiB budget. Each unit has at most
20,000 sources. Missing, duplicate, unordered or failed dependencies are rejected
before a consumer is compiled. Seed artifacts are not recompiled or returned as
new outputs.

Successful results include one `projectArtifacts` record per newly compiled
context: project/context identity, output path, assembly name, PE/PDB bytes,
resources, culture satellites and metrics. Diagnostics retain project/context
identity. A failed dependency blocks its consumer; an unsuccessful overall plan
has no startup assembly, image or PDB. The optional synchronous `compileUnit`
test seam returns `success`, `diagnostics`, `metrics`, and successful assembly and
image values. It receives isolated sources, resolved options and emission inputs.

Structured generated AssemblyInfo records become assembly metadata. Source type
and member definitions preserve public/internal access and readonly fields using
the compiler's public declaration APIs. Neutral resources stay in the main PE;
culture resources produce separate resource-only satellite assemblies.

`createCompilationHandler(workspace)` returns the worker's `(params, method)`
handler. Analysis retains Workspace compilation caches and emits no PE/PDB.
Standalone builds preserve emission reuse across newly derived equivalent
metadata. The artifact cache keys image identity and assembly name and compares
exact bounded snapshots of emission options, including copied byte views.
Metadata, reference/resource bytes, names or images that change invalidate reuse.
The default cache retains eight names per live image, at most 250,000 option
values and an 8 MiB accounted data budget per option snapshot. Unsupported,
cyclic or oversized options bypass caching without changing emission. It never
serializes large byte arrays into JSON keys.

The worker contract is exercised by `a23-project-plan-artifacts.test.js`; the
cache correction has `a23-worker-emission-cache.test.js`. Existing artifact
assertions are preserved from integration source. The new cache cases await the
scheduled combined correction run when this projection is prepared; the PR
qualification record gives the latest actual result. No independent test matrix
was launched for the publication projection.

This batch provides callable application modules. Compiler-worker message
registration, document release, Studio lifecycle wiring, and native/browser
execution qualification remain in their owning integration batches. There is no
new runtime dependency or automatic file-system permission request.
