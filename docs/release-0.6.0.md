# SharpForge 0.6.0 — checked MSIL, resource cleanup and reversible debugging

Release date: October 2, 2026. Built from the uploaded **SharpForge 0.5.0** source. This release is a development preview with substantive compiler, runtime, debugger and IDE changes; it is not full C#, CLR, MSBuild or Visual Studio compatibility.

## Downloads and starting

The source archive includes all source, tests, examples, documentation, workflows, the static browser build, standalone HTML and **15 independently installable 0.6.0 package tarballs**. The browser and package archives contain those outputs separately. Nothing was published to GitHub, a package registry or a public host.

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm start
# Build updated static output and self-contained HTML:
npm run standalone
```

Node 22 or later is required for development and CLI tools. Browser runtime code has no third-party network runtime dependencies. Standalone HTML needs inline scripts and Blob workers; browser restrictions can prevent it from opening locally. Serve the browser build from a suitable static host. Normal HTTP/file-origin loading was not qualified in this runner; see the validation report.

## C# compiler and emitted MSIL

**Checked arithmetic is implemented end to end.** Lexically scoped `checked`/`unchecked` expressions and blocks support int32 addition, subtraction, multiplication, negation and double-to-int conversion. The compiler emits actual `add.ovf`, `sub.ovf`, `mul.ovf` and `conv.ovf.i4` instructions. Checked context does not propagate into called methods. Array/property compound updates retain evaluation order, and overflow prevents the destination write. The IR VM, canonical CIL reload, direct CIL and editable-IL roundtrip are tested against the same expected results.

A new bounded constant evaluator handles supported primitive literals, const-local references, arithmetic, bitwise operations, conditional expressions, casts and constant switch labels. Constants retain their declared type. Default constant overflow is diagnosed independently of runtime defaults; explicitly `unchecked` expressions can wrap. Invalid nonconstant initializers, division by zero, duplicate case values and unsupported declarations produce diagnostics. This is not the full C# numeric/constant-expression specification. For unchecked nonfinite/out-of-range floating-to-int32 conversion, SharpForge consistently chooses `Int32.MinValue`; this is a documented runtime-profile choice, not a universal CLR result guarantee.

**`using` statements and declarations emit real cleanup regions.** Supported concrete classes explicitly implement `IDisposable` or `System.IDisposable` and provide public parameterless instance `void Dispose()`. Emission includes `InterfaceImpl` metadata and the implicit implementation method flags. Resources acquire left-to-right and dispose in reverse order, expressions are captured once, null resources are skipped, and resource bindings are read-only. Tests cover normal exit, returns, break/continue, acquisition failure, disposal failure, nested cleanup and GC roots. General interface variables, arbitrary inheritance/interface dispatch, ref structs and async disposal are not implemented by this feature.

Disk projects now honor **`CheckForOverflowUnderflow`**, including different defaults in source-combined project references. A linked file with conflicting project defaults is rejected rather than assigned an arbitrary context. Loose C# CLI inputs accept `--checked`; project inputs use their own evaluated settings and reject the ambiguous override. No MSBuild tasks, package restore or separate binary linking was added.

## Direct IL execution, managed state and garbage collection

`CilVirtualMachine.snapshot()` and `restore()` preserve frames, arguments, locals, operand stacks, static state, initialization state, heap records, pending exception/finally continuations, output and instruction counters. Snapshots belong to the same VM instance. Frame/allocation identities remain monotonic when restoring earlier state, preventing recycled storage from matching stale descriptors.

A centralized storage-write observer covers arguments, locals, static fields, object fields, array elements and primitive boxed storage, including supported address-based writes. Storage is checked for bounds and allocation identity. Heap mutation revisions now track these writes. Debugger-initiated collection records a checkpoint when history is enabled. Tests reverse through writes, collection and exception cleanup, then replay to the same results.

The collector remains non-generational, non-moving mark-and-sweep. Snapshot memory is additional host memory; the estimated history budget is not a hard bound on all JavaScript engine allocations. This release does not add a JIT, a concurrent collector or arbitrary CLR assembly compatibility.

## Ordinary DLL/EXE debugging and DAP

**`CilDebugSession` now supports Step back and Reverse continue.** Bounded pre-instruction/pre-edit history restores managed state instead of merely moving the highlighted instruction. Reverse continue searches earlier breakpoints and recorded exception/write stops, or reaches the earliest retained state. It works from paused, terminated and faulted sessions. A removed data breakpoint can still have a recorded historical stop.

The reusable API defaults to recording off; Studio's **Record IL history** checkbox defaults on for Debug IL. The default enabled budget is 128 snapshots and 8 MiB of estimated history. The panel exposes retained count, estimated bytes and dropped snapshots. Disabling recording avoids snapshot copying; it is appropriate for running without reverse debugging. Output buffers are restored, but external callbacks and external-world effects cannot be retracted.

**Write breakpoints** are available for arguments, locals, statics, object fields, array elements and primitive boxed values. Descriptors validate frame/slot or handle/allocation generation, with bounded Boolean conditions and hit rules. Studio offers **Break on write** on direct-IL locals/arguments and expanded object/array values; MSIL Disassembly lists the breakpoints and supports removal/clear. Stops occur after the write, while the following instruction breakpoint remains observable.

The real worker and installed DAP stdio adapter expose the same history/data-breakpoint implementation. DAP launch capabilities reflect recording settings; variable references are invalidated after relevant state movement. Installed LSP/DAP executable tests remain part of offline package verification. This is not a native CLR attach debugger, Portable PDB implementation, or external IDE-client qualification. Existing DLL inspection, conservative decompilation, actual instruction bytes and editable-IL execution remain available; unsupported reconstruction still falls back to IL.

## Editor, navigation and docking

`SyntaxHighlightIndex` builds a per-revision lexical/bracket index and supplies source-faithful viewport ranges. Studio paints only visible syntax and gutter lines, with token/line limits and a plain-text fallback for oversized input. Binary-search viewport lookup avoids constructing a full-document highlighted DOM on every scroll. **The native textarea still contains the full document, and supported-size edits still rebuild a whole-document lexical index**; this is not a fully incremental rope/piece-table editor.

Repeated native input events containing identical text no longer trigger duplicate document revisions/rebuilds. A browser test covers a 300-line replacement that produces duplicate Chromium events, and a separate test opens and scrolls a 12,000-line disk file. A disposed guard prevents late resize callbacks from touching removed editor elements.

Ctrl+Alt+Right/Left expands/shrinks syntax selection with worker-provided UTF-16 ranges. Alt+Left/Right and the navigation toolbar restore earlier document/caret locations. Existing editor undo and version validation remain intact.

The 22-tool docking workspace preserves tab-strip scroll positions and reveals active captions after activation or layout changes. The MSIL byte column is wider for readable disassembly. Existing split documents, floating tools, auto-hide, layouts and same-origin popout behavior are retained and regression-tested; this is not pixel-exact Visual Studio docking parity.

## Refactoring, generators and analyzers

New candidate-compiled, version-checked actions make supported immutable literal locals `const`, convert return-only `if/else` to a conditional return, convert eligible methods to expression bodies, and convert `using` statements into declarations inside a preserved lexical block. The latter retains the original disposal lifetime rather than extending it to the surrounding method. Unsupported shapes, unsafe type changes and destructive comment loss are declined.

The schema generator can produce constructors and immutable getter-only property models. Field count and identifiers are validated, and generation failures roll back output. A new syntax-local unreachable-statement analyzer (`SFAN1005`) detects statements after known local exits; it is not whole-program control-flow analysis. Docked per-code severity settings persist and flow to the compiler worker. Generators/analyzers are still trusted synchronous JavaScript extensions, not Roslyn DLL plugins or a sandbox for hostile callbacks.

## Examples

Studio has **29 examples: 28 executable cases and one deliberate diagnostics case**. Eight new examples cover checked arithmetic, disposal, acquisition failures, constants, refactoring, immutable schema generation, analyzer configuration and reversible storage. All eight execute through IR, canonical CIL, direct CIL and exported/reassembled IL tests; generated examples use actual generator output.

The new `CheckedResources` solution demonstrates different overflow defaults across source-combined project references:

```sh
node apps/cli/main.js run examples/projects/CheckedResources/CheckedResources.slnx
# checked project
# -2147483648
# disposed

node apps/cli/main.js invoke examples/managed/StorageWrites.exe --method Main
# Return: 42
```

`StorageWrites.exe` is independently hand-authored CIL without `#SF` and has a matching editable `.sf.il` document. Open it in Assembly Explorer, enable Record IL history, and choose Debug IL. Break on writes to the integer local or array element, step back, and replay. `UsingResources.exe` is a separate compiler-emitted ordinary-IL cleanup fixture, also supplied with editable IL. Existing managed examples remain included.

## Verification and remaining work

**1,006 Node tests, 99 JavaScript syntax checks, 108 browser acceptance checks, 21 standalone checks and all 15 isolated offline packages passed.** See `validation-0.6.0.md` and the retained machine-readable reports for exact scope and reproduction. The browser harness uses production modules and actual compiler/runtime workers, not a replacement implementation.

Broad type-system/numeric completeness, generics, inheritance/general interface dispatch, delegates/LINQ/async, full BCL and multi-assembly binding, full C# decompilation, Portable PDB/native debugging, Roslyn binary extensions and full MSBuild/NuGet remain major gaps. Native filesystem write dialogs, durable browser storage, desktop CLR/ILVerify and broad third-party DLL interoperability were not newly qualified. No hosted CI/deployment run or security audit was performed.

## Language and protocol references

Implementation was checked against the public language and protocol descriptions below; these references are not evidence of runtime interoperability qualification.

- Microsoft C# reference — checked/unchecked: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/checked-and-unchecked
- Microsoft C# reference — using: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/using
- Debug Adapter Protocol specification: https://microsoft.github.io/debug-adapter-protocol/specification
