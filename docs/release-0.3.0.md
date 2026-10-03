# SharpForge 0.3.0 — managed IL and extensible language services

Development preview built by extending the uploaded 0.2.0 source. Nothing was published to npm or a remote repository.

## Implemented

**DLL/IL:** standard CIL opcode decoder; bounded recursive signature reading; declaration/EH-aware assembly inspection; a separate no-#SF direct-CIL interpreter; conservative C# reconstruction with complete method-IL fallback; metadata-preserving editable IL, rebuilding all method bodies and stripping invalid signatures/debug maps; CLI inspect/verify/invoke/decompile/IL export/assembly; an asynchronous Studio Assembly Explorer with argument input and explicit execution.

**C#:** constant-case switch statements, grouped cases, default and fallthrough/duplicate diagnostics; constant/discard switch expressions; int/double casts; typed default; null-coalescing assignment; unchecked expression/block syntax; empty protected-region lowering fix. Existing IR, PE emitter, strict loader and VM agree on the new conversions.

**Runtime/GC:** BigInt integer arithmetic, tagged floating-point values, checked/unsigned conversions, narrow primitive storage, primitive result marshaling, branches/switch, calls/static constructors, objects/arrays, limited managed byrefs, selected intrinsics and catch/finally/fault. Preflight rejects unsupported operations; execution remains budgeted. GC reuses marking/worklist buffers, adds strong/weak host root handles and reports trace/pause counters. The original source-debugging VM remains separate.

**IDE/LSP:** versioned transactional edits and supported bound rename/local-type rewrites, Ctrl+. preview, Shift+Alt+F indentation formatting, workspace symbols, prepare-rename, highlights, folding ranges, selection ranges, code actions and type hints. Existing editor/debugger controls remain. Read-only generated documents appear in a separate view.

**Extensions:** independently packaged JavaScript generator/analyzer driver, immutable inputs, exact-input caching, output/error limits, rollback on failed generators, cancellation checks, additional files and analyzer severity policy. Build-info/schema generators and local-reference/empty-catch analyzers are included. Studio saves selected configuration with exported projects.

**Packaging:** thirteen versioned MIT ES-module packages, standalone HTML, static browser build, examples and expanded regression/browser/offline-package tests. CI includes both browser suites and standalone smoke checks; no hosted run was performed here.

## Important boundaries

This is not full C#/CLI/Visual Studio compatibility. Ordinary DLL inspection is broader than execution. General dependency binding, full BCL/CLR type verification, generics/complex value types, external/native imports and source debugging of arbitrary DLLs are absent. C# decompilation is conservative; unsupported methods remain full IL rather than invented high-level code. Editable SharpForge.IL/1 is not ilasm and preserves existing metadata definitions. Generators/analyzers are trusted synchronous JavaScript, not Roslyn .NET DLLs or forcibly preemptible untrusted plugins. GC remains non-generational stop-the-world mark/sweep, not concurrent/compacting.

See [current validation](validation.md), [managed IL contract](managed-il.md) and [compatibility](compatibility.md) for evidence and exclusions. Historical 0.2 independent Mono/WASM results are retained separately and are not counted as a new 0.3 run.
