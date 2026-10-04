# Reference assembly output

`compileToReferenceAssembly(source, { refout: true })` emits a deterministic compile-time contract with the standard
`System.Runtime.CompilerServices.ReferenceAssemblyAttribute`. The default call continues to emit metadata for every
declaration, with throw-null method bodies, for existing declaration-inspection consumers.

```js
import { compileToReferenceAssembly } from '@sharpforge/compiler';

const result = compileToReferenceAssembly(`
  public class Calculator {
    public int Add(int first, int second) { return first + second; }
    private int ImplementationDetail() { return 42; }
  }
`, { name: 'Calculator', refout: true });

if (!result.success) throw new Error(result.diagnostics.map(item => item.message).join('\n'));
// Save or transmit result.assembly, a PE/CLI Uint8Array, as the reference for a consuming compilation.
```

## Contract and member policy

The policy follows the [Roslyn reference assembly specification](https://github.com/dotnet/roslyn/blob/main/docs/features/refout.md).
All source types remain, including internal and private nested types. Public, protected and protected-internal members
remain. Private fields and functions are removed from classes; internal and private-protected members remain only when
the assembly declares `InternalsVisibleTo`. The following semantic exceptions also remain:

- Virtual methods and explicit interface implementations, with their MethodImpl rows.
- All struct fields, including private, static and auto-property backing fields.
- Fixed-buffer field signatures and attributes, including generic and nested generic owners, through the executable emitter's planner.
- Captured primary-constructor fields through the executable emitter's existing planner.
- Constructors of attribute classes, including internal constructors needed by applied attributes.
- Properties and events with retained accessors. A removed private setter has no dangling MethodSemantics row.

Roslyn reference output omits the generated fixed-buffer storage TypeDefs. Their field signatures retain nested
TypeRefs scoped to the current module, with inherited generic arguments; `FixedBufferAttribute` supplies the element
type and length. Its serialized element type is qualified with the same canonical AssemblyRef identity the emitter
uses. Executable output retains its storage TypeDefs and layout rows.
The captured Roslyn `/refonly` image itself does not support consuming those fixed-buffer fields: SDK 10.0.201 reports
`CS0648` for ordinary, generic and nested generic accesses because the generated storage definition is absent.
Reference output follows that native shape. Its non-buffer API surface remains consumable, including ordinary fields
on the generic owning structs. The original full consumer is retained as a negative diagnostic-parity fixture.
Retained auto-property and primary-constructor backing fields carry `DebuggerBrowsable(Never)`, and instance struct
auto-property getters carry `IsReadOnlyAttribute`. These reference-contract attributes leave the historical
metadata-only profile unchanged.

Attributes on retained declarations use the existing custom-attribute writer. An explicitly applied reference-assembly
marker is preserved once. Both `ReferenceAssemblyAttribute` and `InternalsVisibleToAttribute` can be written in source
using the default framework symbol registry, or resolved from supplied metadata references.

Well-known assembly attributes are recognized by their bound top-level, nongeneric source name, as Roslyn recognizes
them. A generic or nested type with a similar name does not qualify. Same-file types participate in qualified names,
namespace imports and type aliases before framework types are considered; they do not leak into another file or an
extern alias. Explicit interface metadata names likewise use the resolved interface, including namespaces, nested
constructions and expanded tuple types. Only the accessors the binder maps to an interface receive implicit virtual
slots. Explicit-only indexers do not add `DefaultMemberAttribute` to their implementing type.

There is a source-defined attribute exception to the normal CLR marker contract. When source explicitly applies a
file-local `System.Runtime.CompilerServices.ReferenceAssemblyAttribute`, Roslyn recognizes its unmangled source name
and preserves the applied attribute without synthesizing another one. Its emitted type name is mangled, so the image
has no attribute with the standard CLR name and can load. The analogous file-local `InternalsVisibleToAttribute` keeps
internal declarations without emitting the standard friend-assembly identity. SharpForge follows that observed
source behavior. Use the framework attributes for the conventional reference and friend-assembly identities.

Every concrete managed method shares one `ldnull; throw` body. Abstract methods and runtime delegate methods have no
body. A removed static constructor still determines the type's `BeforeFieldInit` flag. Body edits and edits confined to
removed declarations leave the emitted bytes unchanged. A primary-constructor capture edit that changes struct storage
also changes the contract's layout. Changes to a retained constant or public signature change the
contract bytes. The existing deterministic PE finalizer computes the content-derived MVID and timestamp.

`refout` must be a boolean when supplied. A netmodule request fails with `SF3001`; an assembly manifest is required.
Fixed buffers in generic and nested generic structs use the compiler's shared storage-type planner; invalid lengths
still fail with the source diagnostic `CS1665`.
Source diagnostics still apply, including errors in method bodies. There is no tolerate-errors mode or implicit change
to executable compilation. Reference output contains no source debug data, PDB, managed resources or native resources.
`compileToIL` remains the executable compiler API. This option produces one reference output and does not add a CLI
`/refout` path switch or a second output to `compileToIL`.

## Low-level CIL API

| API | Contract |
| --- | --- |
| `referenceAssemblyMemberIncluded(table, flags, context)` | Constant-time policy over `TableId.Field` or `TableId.MethodDef`, unsigned 16-bit flags and boolean `includesInternals`, `isStruct`, `isAttributeConstructor`, `isExplicitImplementation` facts. Invalid values throw `CilError`. |
| `addReferenceAssemblyAttribute(builder, assembly?)` | Add the standard zero-argument marker through an explicit contract assembly or the builder's framework default. Identical calls are idempotent. A missing Assembly row fails before mutation. Source-defined markers are retained by their caller. |
| `assemblyReferenceIdentity(builder, name)` | Resolve the configured or fallback identity used for AssemblyRef emission without adding a row. Returned version and key bytes are owned copies; invalid names and missing required profile identities fail exactly as emission does. |

The compiler applies the policy through `SymbolMetadataWriter`'s existing synthesized-member planning seam before token
allocation. No completed metadata image is rewritten and no token-remapping pass is introduced. Member filtering is
linear in planned declarations. Attribute ancestry is cached per compilation and rejects cycles or more than 256
uncached base links; the cache is released with the compilation. There are no process-global caches or dependencies.

## Verification

Focused tests are `tests/a03-22-reference-assemblies.test.js`, `tests/a03-22-reference-interface-members.test.js`,
`tests/a03-22-reference-synthesized-metadata.test.js`, `tests/a03-22-reference-identity.test.js` and `tests/a03-22-reference-policy.test.js`.
The source and native observer are in `tests/fixtures/a03-reference-assemblies/`.

```sh
node scripts/limited.js node --test tests/a03-22-*.test.js
node scripts/limited.js node packages/cil/tools/capture-reference-assemblies.mjs --dotnet /path/to/dotnet --output artifacts/a03-reference-assemblies
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-reference-assemblies.mjs --mode refout --output artifacts/refout-performance.json
```

The native capture uses the installed SDK's Roslyn `csc.dll` and reference pack directly, without package restore. It
compares public and friend-assembly metadata through System.Reflection.Metadata: declarations, signatures, constants,
layout, base/interface relations, custom attributes, MethodImpl and accessor associations. The public and friend
corpora include fixed buffers in generic and nested generic structs. Both images are consumed independently: a positive
consumer uses the supported API, the original full consumer retains all three fixed-buffer accesses and compares native
diagnostic codes, text and exact source spans, and a friend consumer verifies visibility. Compiler commands, raw output
and SARIF diagnostics are retained. It checks concrete method bodies and compares CoreCLR's reference-loading HRESULT
against Roslyn while a marker-free control loads successfully. Serialized `typeof` values retain whether an assembly
identity was supplied, require that identity to match an AssemblyRef, and compare the resolved native runtime identity.
This preserves qualification differences even when CoreCLR forwards two contract versions to the same runtime type.
Attribute decoding retains native metadata
identities: source enums use their `value__` storage signatures, and external enums resolve their exact AssemblyRef
through the CLR, including framework forwarders. An independent Roslyn observer probe exercises byte and unsigned
64-bit source enums, an external enum, boxed and array enum values, named arguments and null arrays before comparison.
The source, both images and each completed observation are retained even if a later stage fails. Every retained observation records SDK,
compiler, runtime, platform and input hashes. The separate `edge-roslyn.json` observation was captured from
`edge-source.cs` with SDK 10.0.201 and CoreCLR 10.0.5 on Linux x64, using `/refonly /target:library /deterministic+`
and `/langversion:latest`, the installed reference-pack assemblies and the observer revision identified in that snapshot. It records source,
compiler, observer and reference-image hashes, canonical interface names and the file-local attribute exception above.
The source was named `Source.cs` during capture; file-local name hashes are compiler-specific.

The complete focused gate passed **45 tests, with no failures or skips**, at source revision
`b40e8f7b5b8f5d06ad992da4a0b7446d667a056e`. This includes the A03-T22 tests, executable generic fixed-buffer regressions
and existing compiler attribute-emission tests. The native capture then passed both public and friend cases using
SDK **10.0.201**, Roslyn **5.3.0-2.26153.122**, reference pack/CoreCLR **10.0.5**, on Linux x64. Both cases have 15 source
types, one standard marker and only throw-null managed bodies (20 public-case bodies, 25 friend-case bodies).
Both load attempts match Roslyn's `BadImageFormatException` and HRESULT `-2146234280`; the marker-free control loads.
Positive consumers compile against both images. The original full consumer produces identical `CS0648` diagnostics
and exact source spans for all three fixed buffers. Friend access succeeds in the friend case and yields the same
`CS1061` diagnostic in the public case.

[`qualification.json`](../tests/fixtures/a03-reference-assemblies/qualification.json) records the tested source revision,
tool versions, input and output hashes, test count and native consumer observations. Full image/metadata comparisons,
raw compiler commands, stdout and SARIF are retained under `artifacts/a03-reference-assemblies-qualified-b40/` by that
capture. Subsequent documentation and benchmark-driver commits do not change the tested product source identity.
The completed performance comparison is recorded below.
Browser, Rust-native and Wasm execution are not qualified by these checks: the output is a compile-time reference
assembly and its marker deliberately prevents execution loading.

## Benchmark protocol

The benchmark driver uses this same rich source fixture for every selected compiler checkout. It records compiler and
driver revisions, source/output hashes, compiler entry path/hash, tracked changes, and each compiler dependency's
resolved path. Every `@sharpforge` dependency must resolve inside the selected compiler checkout, so a baseline cannot
silently import current packages. Only a trusted developer-selected local checkout entry point can be loaded.

The first-compilation timing excludes module import. The driver retains 120 repeated timings and heap deltas in
chronological order, excludes the first 20 from summary statistics, and reports the remaining 100 samples. Median is
the mean of the two middle sorted samples; p95/p99 use nearest rank. Compile success, marker/private-member policy and
fixture-type guards run outside timing, and every repeated output must equal the first assembly byte for byte.
A baseline that silently ignores `refout` fails the marker and private-member guards. With `--expose-gc`, garbage
collection runs before each sample. Heap-used deltas are not total allocation or retained-heap measurements.

Run each command alone, using a baseline that accepts the rich fixture and has its own workspace aliases:

```sh
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-reference-assemblies.mjs --mode metadata --compiler /baseline/packages/compiler/src/index.js --output artifacts/refout-baseline.json
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-reference-assemblies.mjs --mode metadata --output artifacts/refout-metadata.json
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-reference-assemblies.mjs --mode refout --output artifacts/refout-current.json
```

The once-only comparison on 2026-10-04 used baseline `c1693a9e322295a43d90c3335885b5b5b3cf8daa` and candidate
`7c73c877c841fa5d4d124edfab980f5896a7e485`, with Node 24.19.0 on Linux x64, AMD EPYC 9V74, nine visible logical CPUs
and 10,451,464,192 bytes of visible memory. The three commands ran sequentially in the team's exclusive heavy slot on
a shared hosted machine; unrelated external workloads were not measured. All three runs passed the mode, compilation
and byte-determinism guards. Each retained all 120 repeated samples; no run was repeated for favorable results.

| Measurement | Baseline metadata | Candidate metadata | Candidate refout |
| --- | ---: | ---: | ---: |
| Median, final 100 samples (ms) | 15.540257 | 15.544988 | 15.166682 |
| p95, final 100 samples (ms) | 23.672052 | 20.191166 | 19.360906 |
| p99, final 100 samples (ms) | 31.668122 | 22.964189 | 23.763267 |
| First compilation, one observation (ms) | 102.270753 | 113.958974 | 127.934818 |
| Compiler import, one observation (ms) | 643.469601 | 530.611755 | 566.799936 |
| Median heap-used delta (bytes) | 3,983,120 | 3,982,488 | 3,913,608 |
| PE image bytes | 4,096 | 4,096 | 4,096 |

Baseline-to-candidate metadata compares whole checkout revisions, including unrelated compiler and package changes;
it cannot attribute a change to reference assembly support alone. Its median changed by **+0.0304%** and p95 by
**-14.7046%**. Within the candidate, refout versus metadata changed median by **-2.4336%**, p95 by **-4.1120%** and
p99 by **+3.4797%**. These modes emit different metadata contracts. Equal PE file lengths include alignment padding
and do not establish equal metadata payload size; no payload-size or browser bundle-size measurement was taken.

First-compilation observations increased by **11.4287%** across revisions and **12.2639%** between candidate modes.
Candidate refout's import observation increased by **6.8201%** over candidate metadata. These exceed the 5% latency
review threshold and are disclosed for coordinator review; they are single observations, not an established startup
regression estimate or a performance-budget pass. The calculated sum of candidate import and first compilation
increased by **7.7825%**; that sum excludes other driver startup work. The driver imports its candidate CIL inspector before timing the
selected compiler import, so the baseline loads a separate CIL copy while the candidate can reuse its preloaded copy.
Consequently import timing is a harness observation, not an equivalent clean-startup comparison. No measured PE size
increase exceeds 10%. GC ran before each repeated sample and the wrapper capped V8 old space at 2,048 MiB; heap-used
deltas include temporary allocations and do not establish total allocation or retained-heap changes.

The [evidence archive](evidence/a03-reference-assemblies/README.md) retains the complete benchmark reports, logs,
exact command/environment/status records and frozen preparation manifest. It also retains the actual successful
native `reference.json`, both image pairs, all SRM observations and consumer diagnostics, and the 45-test TAP at b40.
The benchmark's refout image hash matches that qualified public image. Historical failed captures and the independent
both-image consumer probe have separate directories and remain labelled as failures or probes.

## Changes outside A03

The compiler's reference-emission adapter applies the policy, registers the two framework attribute descriptors and
preserves the static-constructor fact when filtering its member plan. These are narrow integration changes in existing
metadata modules. Existing fixed-buffer and primary-capture planners supply required struct storage. Fixed-buffer
type lookup now uses the planner's `byType` index rather than a scan per generated buffer. The source assembly and
type/attribute binders share a per-file namespace index so qualified well-known attributes retain their bound identity.
Canonical explicit interface names and precise accessor flags apply to the shared metadata writer. No compiler entry
point, parser, executable instruction lowering or runtime dispatcher changes. Type references to omitted synthesized
nested declarations now form a valid local TypeRef chain, and method flags preserve internal virtual override access
checks while static interface event accessors do not allocate instance virtual slots.
The compiler's fixed-buffer attribute writer imports the public CIL identity resolver and reuses its existing
`AssemblyIdentity` formatter; it does not duplicate fallback versions or public-key token computation.
