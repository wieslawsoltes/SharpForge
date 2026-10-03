# SharpForge 0.5.0 — 2026-10-02

Implemented from the supplied 0.4.0 source. Fifteen reusable packages, a self-contained browser application, static distribution, actual compiler/runtime workers, examples, CLI/protocol executables, tests and workflows. This is an executable development preview, **not a complete C#/CLR/Visual Studio replacement**.

## C# and emitted MSIL

Auto get/set properties, getter-only constructor assignment, private accessor modifiers, property initializers, static properties, expression-bodied properties, explicit block/expression accessors, object initializers and compound/null-coalescing property writes. Receivers/getters are evaluated once on supported read-modify-write paths. Synthetic backing fields are private; accessors are actual methods. PropertyMap, Property and MethodSemantics metadata are emitted/reloaded. Explicit accessor method calls and invalid read-only writes are diagnosed. Init accessors, indexers, inheritance/virtual property semantics and C# field-backed properties are not implemented.

`try/finally` and `try/catch/finally` emit actual exception-region tables, leave and endfinally. Returns and loop break/continue unwind protected regions. Finally cannot return or branch out. Exceptions in cleanup replace pending failures as exercised by the regression suite. Nested caught exceptions retain lexical rethrow identity. Both runtimes preserve nested pending continuations; GC roots and source snapshots include them. Empty protected bodies emit a real NOP sentinel.

The source language/IR remains a subset. NOP and ENDFINALLY are additive IR instructions; old images load in 0.5, but older runtimes should not consume newly emitted 0.5 artifacts.

## Runtime and ordinary-DLL debugger

The direct-CIL VM adds fixed-width primitive `sizeof`, `cpobj`, and `unbox` managed addresses. Unboxed addresses refer to the original box and retain their owner during collection. General struct layout, native addresses, generic instantiation and full CLI verification remain unsupported.

New exported `CilDebugSession` works directly from uploaded/disk DLL/EXE bytes without #SF. It implements exact instruction breakpoints, bool conditions, hit rules/logpoints, function breakpoints, instruction step-in, depth-based next/out, pause, run-to-instruction, first-chance/uncaught stops, safe watches, primitive argument/local editing, stack frames and bounded actual-byte disassembly. Source mappings are optional; without them source navigation is absent rather than guessed. Reverse execution is rejected in this profile.

Studio's **MSIL Disassembly** is the 22nd independently dockable tool, separate from IL Compiler Output. Assembly Explorer has **Debug IL** and **Assemble + debug** actions. It displays the executing assembly, supports breakpoint configuration/Run to, follows selected frames, pages long methods, and floats/redocks without losing state. Restart reuses the current DLL, arguments and IL breakpoints. Edited IL is reassembled before execution/debugging.

Source debugging adds temporary run-to-cursor (Ctrl+F10), safe reads of known auto-property backing fields, pending-finally snapshot preservation, and validated allocation-generation-aware data-breakpoint APIs. The data API is not a new DAP/Studio data-breakpoint manager. The collector remains precise logical mark-and-sweep on JavaScript, not concurrent/generational/compacting GC.

## Editor, refactoring, services and extensions

Ctrl+F/H: bounded literal find/replace with case/word options, match status, previous/next, and single-action replace undo. Ctrl+G: line/column navigation. Syntax-aware bracket matching ignores strings/comments; Ctrl+Shift+Backslash navigates pairs. Shift+Alt+Up/Down duplicates lines. Cached line/lex lookup replaces repeated line splitting in cursor paths. Large-document highlighting falls back above 200k characters. Reusable editor CSS is exported in its package. There is no fully virtualized large-document editor or advanced shaping renderer.

Ctrl+. adds intentionally narrow versioned/candidate-compiled structural rewrites: whole-initializer/return-expression local extraction, immutable-literal inlining, block if/else inversion, and initialized get/set auto-property expansion. Unsafe receiver/call subexpression extraction, mutated/nameof locals and getter-only property expansion are not offered. Existing bound rename/type actions/formatting remain. This is not general Extract Method or a Roslyn semantic proof engine.

LSP publishes property symbols/semantic tokens and the structural action kinds. The protocol package now installs **sharpforge-lsp** and **sharpforge-dap** stdio binaries, with incremental byte-counted UTF-8 framing, limits, shutdown/error handling and queued cancellation. DAP adds direct-IL launch, instruction breakpoints/disassembly/restart and per-session capabilities. The local DAP host can load an explicitly selected disk `program`. No real CLR process attach, general external-client integration or full protocol conformance is claimed.

JsonSchemaGenerator optionally emits auto-properties. ConstantConditionAnalyzer reports literal conditions; TodoCommentAnalyzer reads task markers only from comments. Severity suppression/escalation works through the existing extension driver. Extensions remain trusted synchronous JavaScript callbacks, not Roslyn DLLs or an untrusted-plugin sandbox.

## Examples and use

Seven new independently executable source examples bring Studio to **21 examples** (20 executable and one intentionally invalid diagnostics case). The source archive has `examples/features-0.5/` plus a new disk `.slnx`/`.csproj` project, `PropertiesAndCleanup`. The managed directory adds `PrimitiveAddresses.exe` (hand-authored, no #SF; returns 52) and `Finally.exe` (compiler-produced, no #SF), both with editable IL.

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm start
node apps/cli/main.js run examples/features-0.5/finally.cs
node apps/cli/main.js run examples/projects/PropertiesAndCleanup/PropertiesAndCleanup.slnx
node apps/cli/main.js invoke examples/managed/PrimitiveAddresses.exe --method Main
npm run lsp --silent
npm run dap --silent
```

## Validation and boundaries

See [validation-0.5.0.md](validation-0.5.0.md) for exact counts and reproducible evidence. Selected new property/finally tests use four paths: internal IR VM, canonical CIL reload, direct CIL, and exported/reassembled IL. Protocol tests spawn real local processes. Browser/standalone tests use actual workers, not simulated interpreter results.

No new desktop CLR/ILVerify run, broad independent Roslyn-DLL corpus, hosted CI deployment, normal HTTP/file-origin browser loading, native filesystem dialogs, durable browser storage or full Visual Studio integration was qualified in this environment. Browser HTTP navigation was blocked by the environment; the separately documented in-memory production-module harness was used. Existing historical CLR/WASM reports are not represented as new validation.

Remaining major product work includes generics/inheritance/interfaces/structs/records, delegates/lambdas/LINQ/async/iterators, broad frontend numeric and C# semantic conformance, full BCL and separate-assembly binding, Portable PDBs and arbitrary C# decompilation, Roslyn binary extensions, full MSBuild/NuGet, native debugging, richer refactorings, truly incremental compilation and virtualized editing. There is no registry publication or GitHub deployment in this delivery.

## Design references

Microsoft's C# class/property specification and exception statements guide informed the supported contracts: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes and https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/exception-handling-statements . Primitive unbox behavior follows https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.opcodes.unbox . Protocol references are in protocols.md. These references do not establish full implementation conformity.
