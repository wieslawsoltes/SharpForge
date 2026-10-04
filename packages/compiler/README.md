# @sharpforge/compiler

Cross-file binding and supported semantic checks with managed bytecode emission.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/compiler';
```

Use `compileToReferenceAssembly(source, { name: 'Library', refout: true })` for a deterministic reference assembly
with inaccessible members removed and `ReferenceAssemblyAttribute`. The default metadata-only output remains
available. See [Reference assembly output](../../docs/reference-assembly-refout.md) for the policy, example and checks.

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## 0.10 integration

This package participates in Portable PDB symbols, cooperative async/logical-thread execution, managed Hot Reload, explicit evaluation, guarded instruction relocation and the code-first WinUI web profile. See the source distribution `docs/advanced-debugging-winui.md` for exact semantic limits; no native CLR/WinRT or full Visual Studio compatibility is implied.

Registered types may specify `defaultMember: 'Chars'` (a nonempty string) to select
their indexed property. Closed and open generic symbol binding and the legacy
compiler resolve the corresponding existing `get_Chars` / `set_Chars` contracts;
no alias methods or contract IDs are created. An absent marker inherits a
registered base's marker, then falls back to the released `Item` convention.
The metadata name rule is defined once in `src/symbols/registry-indexers.js`.
Built-in string element lowering remains separate, including its read-only char
behavior. This seam supports the registry's existing accessor shapes; it does not
add multi-argument indexer execution or reflection attribute import.

`tests/compiler-lowering-registered-indexer.test.js` covers named metadata through
semantic binding and the extracted legacy preparation/load/store seam, plus
existing Item and string execution through both pipelines on source/CIL VMs.
Real StringBuilder `Chars` execution is qualified by its dependent BCL feature.
`scripts/benchmarks/a07-registered-indexer-compile.mjs` measures identical existing
Item/string sources on parent `938d86fe` and candidate, with one warmup and five
samples for each compiler pipeline. It performs no VM execution; host heap deltas
are reported separately from elapsed time and are not allocation counts.

## Source query model

`Compilation.getSourceModel()` lazily returns a revision-local `SourceSemanticModel`
over the lossless-source binder. Its `symbolAt(uri, offset)`, `referenceAt(uri,
offset)`, `documentSymbols(uri)` and `metadataAt(uri, offset)` queries use UTF-16
offsets. `symbols`, `references` and `hints` retain source declaration identity,
qualified namespaces/base types, read/write/declaration flags, and selected
argument-to-parameter bindings. `nameof` references are retained without creating
execution edges; delegate conversions refer to the selected method overload.

`sources` and `result` retain the analyzed snapshots and diagnostics.
`records`, `symbolsById` and `localInitializerTypes` expose bound symbols/types
for detached refactoring validation. All returned data belongs to the compilation
revision and must be treated as read-only. The model never emits or changes
program code. `Workspace.sourceModel()` in `@sharpforge/workspace` handles source
and option invalidation for callers. See `docs/editor-language-providers.md` in
the source distribution for the provider/transaction contracts and evidence.

## Reference assemblies

`compile`, `compileToAssembly` and `compileToReferenceAssembly` bind framework names against the closed framework
registry by default. With the `references` option they bind against real reference assemblies instead: each entry is
`{ bytes, display?, aliases? }` (an ECMA-335 image, the name diagnostics show, extern aliases). When one of the
references defines `System.Object` it replaces the registry, and `compileToAssembly` writes its AssemblyRef, TypeRef,
MemberRef, TypeSpec and MethodSpec rows against the referenced assemblies, so the emitted assembly runs on real .NET.

Decoding the references is the expensive part (the .NET reference pack is 167 assemblies). `createReferenceSet(entries)`
decodes them once and returns the list to pass as `references` to any number of compilations; the set is an explicit
object owned by the caller, not a process-wide cache.

`@sharpforge/compiler/node` (Node only) finds and reads the reference pack of an installed .NET SDK:
`locateReferencePack({ dotnetRoot?, targetFramework? })`, `readReferenceFiles(paths)` and
`loadReferencePack(options)`, which returns `{ references, pack }` or null when no pack is installed.

```js
import { compileToAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';

const { references } = loadReferencePack();
const result = compileToAssembly(source, { name: 'App', references });
```
