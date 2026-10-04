# Closed project assembly execution

SharpForge project references remain separate emitted PE files. The compiler
records full assembly identities and exact PE hashes, and `loadProjectAssembly`
from `@sharpforge/cil` verifies the complete explicitly supplied dependency set.
No runtime path, network, package or assembly-name lookup is performed.

```js
import {loadProjectAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, createProjectAssemblyInspector} from '@sharpforge/runtime';

const dependencies = [{assembly: libraryBytes, project: 'Library/Library.csproj', contextId: 'net10'}];
const graph = loadProjectAssembly(applicationBytes, {dependencies});
const sourceResult = new VirtualMachine(graph.image).run();

const inspector = createProjectAssemblyInspector(applicationBytes, {dependencies});
const cilResult = new CilVirtualMachine(inspector).run();
```

`createProjectAssemblyInspector(assembly, {dependencies, signal, assemblyLimits})`
returns an `AssemblyInspector` execution view accepted by the existing direct CIL
VM and debugger. It always verifies the supplied canonical graph first. The
optional signal cancels graph loading. `assemblyLimits` is passed to canonical PE
admission. Invalid input throws a coded `CilError`; the graph diagnostics use
`PRJ0001` through `PRJ0007` as documented by `@sharpforge/cil`.

The view maps each original module's metadata rows, user strings, method bodies,
exception handlers and sequence points into disjoint token ranges. Methods
continue to execute through the ordinary CIL dispatcher. All modules share one
managed heap, method tables, static state and scheduler inside a VM. Creating a
second VM gives it independent state, even when inspection data is reused.

`inspector.modules` retains the verified original inspectors, owned byte snapshots,
identity and project provenance. `inspector.projectImage` is the corresponding
linked source execution image. `inspector.pe` describes the unchanged entry PE;
`inspector.metadata` describes the logical execution view. The view is not a new
serialized assembly and must not be passed to a PE writer as one. `summary()`
identifies the graph and tags resources with their owning assembly. Resource
payload inspection remains available through each original module inspector.

Library entry modules remain libraries. A direct CIL host can select one of their
static methods using the existing `methodToken` and `arguments` options. Source
launches retain `withSourceLaunchArguments` for the verified compiler startup;
this preserves startup initialization. Direct CIL custom-method invocation keeps
its explicit host argument contract.

## Type and source identities

Runtime type names are opaque registered identifiers. Method tables retain
`assemblyKey` and `metadataName` separately; reflection uses the metadata name and
the owning assembly identity. Arrays and supported framework generic containers
preserve the identity of their registered element types. No consumer splits the
bracket-delimited display representation to recover assembly scope.

Source URI collisions use the graph loader's deterministic `module.sourceUris`
mapping. Sequence points retain `originalUri`, `assemblyKey` and any supplied
`project`/`contextId`. Both debuggers therefore refer to the same executable
documents. Stack frames expose the same provenance and `originalMethodToken`,
which identifies a MethodDef only inside that original assembly. The direct CIL
frame's existing `methodToken` and instruction address remain tokens in the
runtime execution view. Linked source frames retain original module tokens and
source-to-CIL offsets; generated adapters have no original physical token.
Direct graph debug sessions use `autoLoadSymbols: false` and the
verified source maps; a single entry PDB cannot describe remapped dependency
tokens. Studio retains those source identities when opening current workspace
text or the existing read-only verified-source viewer.

## Admission, limits and updates

Constructing the source VM with an unresolved `externalReferences` image throws
`SF_RUNTIME_DEPENDENCIES` before heap allocation or program effects. Bytecode
verification still accepts valid unresolved compiler IR for emission. The direct
CIL verifier likewise rejects unresolved external members before execution.

The graph is bounded to 512 unique assemblies, 32 MiB per PE, 64 MiB aggregate PE
bytes, 8,192 types, 65,536 methods and 65,536 fields. The execution metadata view
also bounds aggregate rows and the CLI token address space. Dependencies with the
same full identity and different bytes are rejected, including conflicting TFM
outputs. Every supplied artifact is validated, including an unused one.

Studio's worker cache key covers all dependency bytes and project context data.
A changed library never reuses a previously verified graph. A failed replacement
launch preserves the existing running or paused session. Multi-module Hot Reload
and external PDB replacement require a full relaunch with the complete graph and
produce `SF_RUNTIME_GRAPH_UPDATE`; single-module behavior remains available.

The compiler's initial closed profile supports canonical SharpForge nongeneric
classes, constructors, ordinary methods, properties, indexers and fields. Its
existing diagnostics reject unsupported external generic, virtual, abstract,
by-reference and native constructs. This is not arbitrary CLR assembly loading.
Rust native/Wasm execution of this graph is not provided by this JavaScript seam.

Source execution preserves the source VM's exception representation for a failed
type initializer and caches the original managed fault without replaying its
effects. Direct CIL retains its existing `TypeInitializationException` wrapper.
The two engines agree on once-only initialization effects and failure propagation;
this profile does not claim identical exception object types between them.


## Worker activity lifecycle

The browser worker composes the verified project loader with the existing
`RuntimeActivity` lifecycle. Activity owns cooperative scheduling, animation clocks
and execution metrics. Constructing and binding a new candidate succeeds before
replacing the active session. Stopping a session also stops its scheduled activity.
The same graph/source helpers serve load replies, launch results and the permitted
single-assembly symbol/update paths, preserving document and assembly provenance.

The shared worker protocol retains the named compiler and runtime operations,
including `executionMetrics`. Closed graph hot reload and independent replacement
symbols still require an explicit complete graph update contract and are rejected.
The source/worker regression scope and upstream activity/occupancy regressions are
qualified together by the integration coordinator.
