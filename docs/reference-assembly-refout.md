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
- Fixed-buffer nested types and layout, including generic owners and their inherited type parameters, through the executable emitter's planner.
- Captured primary-constructor fields through the executable emitter's existing planner.
- Constructors of attribute classes, including internal constructors needed by applied attributes.
- Properties and events with retained accessors. A removed private setter has no dangling MethodSemantics row.

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

The compiler applies the policy through `SymbolMetadataWriter`'s existing synthesized-member planning seam before token
allocation. No completed metadata image is rewritten and no token-remapping pass is introduced. Member filtering is
linear in planned declarations. Attribute ancestry is cached per compilation and rejects cycles or more than 256
uncached base links; the cache is released with the compilation. There are no process-global caches or dependencies.

## Verification

Focused tests are `tests/a03-22-reference-assemblies.test.js`, `tests/a03-22-reference-interface-members.test.js` and
`tests/a03-22-reference-policy.test.js`. The source and native observer are in `tests/fixtures/a03-reference-assemblies/`.

```sh
node scripts/limited.js node --test tests/a03-22-*.test.js
node scripts/limited.js node packages/cil/tools/capture-reference-assemblies.mjs --dotnet /path/to/dotnet --output artifacts/a03-reference-assemblies
node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-reference-assemblies.mjs --mode refout --output artifacts/refout-performance.json
```

The native capture uses the installed SDK's Roslyn `csc.dll` and reference pack directly, without package restore. It
compares public and friend-assembly metadata through System.Reflection.Metadata: declarations, signatures, constants,
layout, base/interface relations, custom attributes, MethodImpl and accessor associations. The public and friend
corpora include fixed buffers in generic and nested generic structs, and the independent consumer accesses both
storage forms from closed instantiations. It checks concrete method
bodies, compiles an independent consumer against the SharpForge image, verifies friend access, and compares CoreCLR's
reference-loading HRESULT against Roslyn while a marker-free control loads successfully. Serialized `typeof` values
are compared by type name because the reference contract versions differ. Attribute decoding retains native metadata
identities: source enums use their `value__` storage signatures, and external enums resolve their exact AssemblyRef
through the CLR, including framework forwarders. An independent Roslyn observer probe exercises byte and unsigned
64-bit source enums, an external enum, boxed and array enum values, named arguments and null arrays before comparison.
The source, both images and each completed observation are retained even if a later stage fails. Every retained observation records SDK,
compiler, runtime, platform and input hashes. The separate `edge-roslyn.json` observation was captured from
`edge-source.cs` with SDK 10.0.201 and CoreCLR 10.0.5 on Linux x64, using `/refonly /target:library /deterministic+`
and `/langversion:latest`, the installed reference-pack assemblies and the observer revision identified in that snapshot. It records source,
compiler, observer and reference-image hashes, canonical interface names and the file-local attribute exception above.
The source was named `Source.cs` during capture; file-local name hashes are compiler-specific. The focused Node gate
passed 40 tests at `e14947ea`; four separate parameter-default reference-pack tests skipped because their SDK path was
not configured. The main native comparison and performance remain pending while the native observer is qualified.
Browser, Rust-native and Wasm execution are not qualified by these checks: the output is a compile-time reference
assembly and its marker deliberately prevents execution loading.

## Changes outside A03

The compiler's reference-emission adapter applies the policy, registers the two framework attribute descriptors and
preserves the static-constructor fact when filtering its member plan. These are narrow integration changes in existing
metadata modules. Existing fixed-buffer and primary-capture planners supply required struct storage. Fixed-buffer
type lookup now uses the planner's `byType` index rather than a scan per generated buffer. The source assembly and
type/attribute binders share a per-file namespace index so qualified well-known attributes retain their bound identity.
Canonical explicit interface names and precise accessor flags apply to the shared metadata writer. No compiler entry
point, parser, executable instruction lowering or runtime dispatcher changes.
