# @sharpforge/compiler

Cross-file binding and supported semantic checks with managed bytecode emission.

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

## Inspecting explicit metadata references

`inspectMetadataReference(bytes)` accepts a `Uint8Array` containing one managed PE/CLI image, up to 64 MiB (67,108,864 bytes).
It reuses the compiler's metadata importer and returns `{name, identity, references}`: the simple assembly name, full display identity
and number of referenced assembly identities. It does not execute code or resolve dependencies. Inspection validates the PE/CLI metadata
needed for that summary; it does not claim to verify method bodies or establish executable runtime compatibility.

Invalid input types and oversized arrays throw `RangeError`; malformed images preserve the metadata reader's explicit error. The function
reads only the supplied byte view and does not modify it. The native SDK metadata service uses this public seam after its own trust,
workspace, file-count and byte-budget checks.
