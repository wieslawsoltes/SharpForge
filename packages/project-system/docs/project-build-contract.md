# Portable target and build-plan contracts

`@sharpforge/project-system` exposes `runPortableTargets`, `createBuildPlan`,
`createBuildUnit`, `resolveBuildContextGraph` and `createOutputLayout`. The same
operations are available on a `ProjectSystem` session through `runTargets`,
`buildPlan`, `buildUnit`, `buildContexts` and `outputLayout`.

## Portable target execution

`runPortableTargets(system, startup, requested, options)` evaluates registered
portable tasks against a copied virtual workspace. `requested` selects target
names; initial/default targets apply when it is omitted. The static graph
retains dependencies, before/after hooks and Inputs/Outputs declarations. Target
and task metadata batching, conditions, output items/properties, CallTarget and
ContinueOnError use the existing expression/item context.

The registry supports Message, Warning, Error, in-target PropertyGroup/ItemGroup,
WriteLinesToFile, ReadLinesFromFile, Copy, MakeDir, Touch, Delete, RemoveDir and
CallTarget. Unsupported tasks, including Exec, Csc and custom task assemblies,
remain blocking SFP1004 diagnostics. No process, native filesystem or network
capability is inferred from a project file. Inputs/Outputs are retained for
batching and host planning; this runner does not claim native timestamp-based
incremental skipping.

The result contains `success`, `project`, `contextId`, `requiredFiles`, `executed`,
`messages`, `awaitingCompilation`, `diagnostics`, candidate `files`, `changedFiles`,
`directories`, `outputBytes`, `steps` and `applied`. Successful results publish
atomically unless `apply: false`. A failed task or required-input hydration
request leaves the live workspace unchanged. Callers inspect top-level
`requiredFiles`, load those bounded paths through their authorized provider, and
retry the same context; unopened files are never treated as empty content.

`options.contextId` selects an exact framework/runtime context. Generated output
records are preserved separately for each context even when two contexts use
the same path. Repeated pre-compilation preparation starts from the initial
evaluated items, avoiding accumulation of generated item declarations.

`phase: 'beforeCompile'` runs SDK hooks up to the explicit compiler boundary and
retains a pending build. The host compiles that context's prepared unit, then
calls `phase: 'afterCompile'` with `outputPath` and `outputs: [{path, bytes}]` from
the successful compiler result. AfterCompile/AfterBuild hooks can read those
actual supplied bytes. Missing outputs fail, and an after phase without a
prepared context throws SFP1803. The caller must not finalize a failed or stale
compilation. Application orchestration owns revision/cancellation checks around
asynchronous compilation and provider reads.

Default limits are 100,000 evaluation steps, 16 MiB of written output and 64
active target calls. Callers may lower `maxSteps`, `maxOutputBytes` and `maxDepth`,
and supply `signal` and deterministic `logicalTime`. Metadata/context errors or
early cancellation may throw; task failures retain located diagnostics in the
result. Continued error diagnostics still prevent publication. Hydration and
budget failures cannot be converted into successful continuation.

## Isolated compilation contexts

`resolveBuildContextGraph(system, startup)` returns dependency-ordered nodes and
`startupContextId` without reading source text. Nodes retain their context ID,
project snapshot and reference edges. Framework selection uses the shared
compatibility reducer and explicit reference metadata. A diamond may include
the same project twice under different TFMs, with distinct node identities.
`BuildReference=false` omits the build edge; `ReferenceOutputAssembly=false`
preserves build order while marking the edge as absent from compiler metadata.
Cycles, unavailable dependencies, incompatible contexts and limits are errors.
The default graph budget is 512 contexts and 100 levels of reference nesting.

`createBuildPlan` materializes one unit per graph node. Each unit contains its
project/context/configuration/platform/TFM/RID, assembly name and output path,
sources, compiler options, project and metadata references, package references,
resources, structured assembly attributes, friend-assembly declarations and
diagnostics. References point to the dependency's output and exact context ID,
and retain Aliases, PrivateAssets and ReferenceOutputAssembly. Source arrays are
never merged across project boundaries. Internal visibility is assembly scoped;
friend declarations are carried to the assembly-emission host.

Executable plans reject absent source text and lazy metadata references.
`buildContexts()` is the metadata-only hydration seam. `createBuildUnit(system,
startup, contextId)` materializes only the selected prepared context, allowing a
host to perform dependency preparation, compilation and finalization in order
before a consumer's targets read dependency outputs.

## Output and host boundaries

`createOutputLayout(projects, startup)` returns output, publish and package file
plans from Content/None metadata. It applies Link/TargetPath, copy modes, Pack
and PackagePath, and includes eligible referenced-project content. Never items
are absent from the relevant copy plan. Escaping copy destinations, invalid
modes and conflicting destinations fail with SFP1601 or path diagnostics.
The helper performs no I/O; native publish/pack and a host's actual file writes
remain separate operations.

These APIs provide complete virtual target execution and isolated build data.
The dependent application/compiler integration is responsible for producing
PE/PDB artifacts, retaining resource and assembly metadata, applying buffer
overlays, and running the selected result. No native task or executable linker
parity is inferred from the pure model tests.
