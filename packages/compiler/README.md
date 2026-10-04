# @sharpforge/compiler

Cross-file binding and supported semantic checks with managed bytecode emission.

## Metadata language queries

`MetadataLanguageModel(files, {references, ...compilationOptions})` decodes explicit PE references and offers
`resolveType(uri, name, offset)`, `members(uri, receiver, {position, receiverStart, prefix})`, `types(uri, prefix, offset)`,
`symbolAt(uri, offset)` and `analyze()`. Offsets use UTF-16 code units. Results are data-only symbols and normal semantic
diagnostics. `update(files, options)` retains decoded assemblies while invalidating source binding; reference changes require a new model.
Queries do not claim executable runtime support. Invalid metadata reports `CS0009`; source, reference and bound-node budgets reject
oversized inputs explicitly. `inspectMetadataReference(bytes)` validates a PE/CLI image and returns its assembly identity without executing it.

A reference may explicitly select `runtimeProfile: 'sharpforge'` when its producer is the SharpForge project compiler. This connects
that assembly's primitive signatures to the consuming compilation's closed runtime type identities. External/native references keep strict
assembly resolution by default; the flag does not enable arbitrary external assemblies or cross-assembly execution.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/compiler';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## 0.10 integration

This package participates in Portable PDB symbols, cooperative async/logical-thread execution, managed Hot Reload, explicit evaluation, guarded instruction relocation and the code-first WinUI web profile. See the source distribution `docs/advanced-debugging-winui.md` for exact semantic limits; no native CLR/WinRT or full Visual Studio compatibility is implied.

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
