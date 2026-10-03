> **0.10 update:** [Advanced debugger and WinUI guide](advanced-debugging-winui.md) and [validation](validation-0.10.0.md) define the new symbol, async, live-editing and web-framework support; older limitations below describe the baseline unless explicitly superseded.

# Architecture and implementation contract

## Pipeline

```text
Editable source snapshots
  → source-preserving tokens and trivia
  → recoverable AST
  → declarations and symbol/reference tables
  → supported type/assignment/flow checks
  → internal stack IR + source sequence points
  → ECMA-335 typed CIL + PE/CLI metadata and #SF source maps
  → one-time IL decoding and canonical-profile verification
  → original predecoded VM instructions
  → VM frames, operand stack and managed handles
  → precise tracing heap + source-level debugger
```

The browser main thread owns the editor, shell, panels and presentation. A compiler worker owns the Workspace and LanguageService. A second worker owns the DebugSession and VirtualMachine. Request IDs correlate replies; document versions and a workspace revision prevent stale results from replacing newer analysis. The IDE debounces ordinary analysis by 120 ms.

Worker isolation is not a claim of preemptive cancellation. Binding is synchronous inside its worker. Cancellation is checked at workspace boundaries, and a stale result is discarded by the host; a compile already in progress is not interrupted midway. The editor indexes a complete document revision on the UI thread up to a default 2,000,000 UTF-16 characters. Rendering then clips source-faithful token runs to the visible line window; beyond the limit it uses a plain viewport fallback. The native textarea and lexical rebuild remain full-document costs.

## Source fidelity and recovery

`SourceText` is immutable and uses UTF-16 offsets, matching browser text inputs. A lazily computed line-start index supports diagnostic and protocol coordinate conversion. Source positions in diagnostics are zero-based; debugger source lines/columns are one-based.

Lexing retains every source character in each token's leading trivia and raw text. Concatenating `token.green.fullText` reconstructs the input exactly, including comments and malformed input. Green **tokens** are immutable and interned in a workspace-owned bounded cache. Their public positioned wrappers point back to source spans.

This is not a full Roslyn-style red/green syntax-node implementation. The AST is an ordinary object tree. Unchanged documents retain that tree; changed documents are reparsed in full. `internedTokenHits` counts cache hits, including repeated token spellings within a parse, not the number of nodes structurally reused after an edit.

The recursive-descent statement/declaration parser and Pratt expression parser insert missing-token placeholders, emit bounded diagnostics and guard against loops that make no token progress. Nesting and diagnostic limits constrain recovery. A syntactically damaged file can still yield symbols and syntax useful to an editor, although recovery quality is not yet equivalent to a mature C# compiler.

Microsoft's syntax-model documentation describes full-fidelity, immutable, recoverable trees as useful compiler/IDE building blocks. SharpForge implements a smaller token-fidelity/recovery design, not API or implementation parity:
https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/work-with-syntax

## Binding and emission

Declarations are collected before method bodies so forward calls and references across files can resolve. Types, fields, overload candidates, parameters, locals, source declarations and bound references have explicit metadata. The binder checks the supported type universe, assignments, selected overloads, basic definite assignment, control-flow placement and some all-paths-return conditions.

The bound lowering and bytecode emitter currently live together in the compiler package. There is no independent SSA IR, optimizer, register allocator or formal control-flow/dataflow framework. Methods emit triples of signed 32-bit words into `Int32Array`, plus locals, exception-handler regions and source sequence points. Instruction operands reference image metadata rather than host functions.

Errors suppress the bytecode image. A verified image can be serialized with `serializeImage()` and restored with `deserializeImage()`. That remains an explicit **legacy/internal** serialization option. The default Studio/CLI artifact is now real PE/CLI with ECMA-335 CIL. The new `cil` package performs abstract stack-type analysis, typed conversion/boxing emission, metadata/token construction, exception-region emission, source/IL offset mapping and deterministic PE serialization. The browser worker receives DLL bytes, not the compiler's original image.

On load, the CIL package reads actual metadata/signatures/method bodies, validates its supported emission profile, translates the supported IL spans back to the same VM operations and canonically re-emits the decoded program to check the entire binary. This costs CPU once and rejects unsupported or modified encodings rather than guessing. The custom `#SF` stream carries source/local mappings and span boundaries, not original VM opcodes or constants. It is required for this canonical source-debugging path, not the separate direct-CIL interpreter. The runtime is not a general CLR assembly loader. See [the complete IL contract](il-backend.md).

`compile()` and Workspace analysis intentionally remain frontend/IR operations. `compileToIL()` performs the explicit backend operation. Studio build requests use the emitter; ordinary diagnostic/completion requests do not. The runtime worker caches a single decoded module after comparing the supplied binary bytes; repeated launches create fresh VM/heap state from it without repeating IL decoding.

## Execution

A frame records its method, instruction index, operand-stack base, local slots, current source point and active exception. Calls and returns use an explicit frame stack. The interpreter implements numeric operations, object/array access, branching, built-ins and managed exception unwinding. Int32 arithmetic uses explicit wrap/truncation modes; strings and reference objects are not delegated to user JavaScript expressions.

`runSlice()` yields by instruction count and elapsed time. The Studio runtime worker schedules approximately 6 ms slices with a 15,000-instruction ceiling. Time checks occur periodically inside the loop, so a long intrinsic or collection can exceed the requested slice duration. The UI remains on a different worker boundary.

The verifier checks code layout, metadata operands, reachable stack heights and joins, branch targets, call arities and handler entries. It is a sanity check, not a proven type-safety verifier for hostile bytecode. The VM itself also checks array bounds, null/stale handles and resource limits.

## Managed lifetime

Objects, arrays, strings and exceptions are allocated in a separate managed heap. A reference is a frozen `{h, g}` handle containing a slot and generation, not the backing JS object. Reusing a reclaimed slot increments its generation so stale handles fail validation.

Marking traverses an explicit work list, including cycles. Roots include the operand stack, statics, frame locals, interned runtime literal references, current/pending exceptions, temporary native-call pins and children supplied during a new allocation. The compiler clears selected temporary and out-of-scope reference slots so they do not accidentally root discarded objects.

Sweeping reclaims unmarked records. Byte sizes are logical managed accounting, not exact JavaScript heap or browser RSS measurements. Browser storage backing these structures remains subject to the JavaScript engine's own collector. There is no claim that a userland heap replaces the browser GC.

Reverse-debug snapshots copy VM/heap state independently, rather than pinning a live managed graph indefinitely. History is bounded by count and an approximate memory estimate. Snapshot storage is outside the managed heap budget.

## Build and deployment

Development source uses native ES modules and npm workspaces. The dependency-free static build rewrites package imports to relative browser paths and emits self-contained classic workers. A deliberately narrow static bundler supports the project's current acyclic named-import/export forms and rejects unsupported module syntax. It generates ordinary source files: no runtime `eval` or `Function` loader.

The browser application uses relative asset paths. `scripts/serve.js` provides a development static server; it does not expose compilation endpoints. `_headers` supplies suggested static-host security headers. Hosting-provider support and production cache/CSP configuration must be validated on the target host.


## 0.3: independent IL and extension paths

`cil/inspector.js` reads broader metadata independently of the canonical source profile. `execution-profile.js` preflights the allowlisted reachable graph; `runtime/cil-vm.js` interprets it directly. Original `VirtualMachine`/`DebugSession` retain their strict profile and source mapping. `il-document.js` rebuilds all visible method bodies against preserved metadata; `decompiler.js` conservatively reconstructs C# or returns complete method IL. Neither unsupported generic metadata nor a decoded opcode implies runtime support.

`@sharpforge/extensions` is a trusted JavaScript driver injected into Workspace: generators run before compilation, analyzers after it, and generated snapshots are separate/read-only. `@sharpforge/refactoring` produces validated versioned edits and supports lexical folding/AST selection. Both are separately packed. Studio worker requests carry file versions and extension configuration; managed-DLL browsing is separate from editing the source project.

## 0.4: project snapshots and docking ownership

`@sharpforge/project-system` owns bounded XML/condition/item evaluation and project graphs. Studio loads selected disk records before replacing the active workspace; `.slnx` selects projects and the startup project's transitive source closure is sent to the compiler worker. This is one combined compilation rather than assembly linking. Disk write handles remain outside project snapshots and are never serialized into recovery JSON. Explicit saves check baselines and permissions before sequential writes.

`@sharpforge/docking` has an independent DOM-free model and a DOM host. The model validates every panel's unique placement and rolls back failed mutations. The host parks and reparents cached nodes rather than rebuilding editor buffers. Each document has a separate CodeEditor and undo history; tools retain their identities in split, floating, auto-hide and same-origin popout placements. A shared workspace and workers remain in the primary window. A short-lived close watcher exists only while popout windows are open.

Partial type declarations are collected before binding without mutating cached syntax trees. Library compilation omits startup entry points and emits per-type static initializers. `nameof` binds a reference but emits a string constant without an execution edge. Call hierarchy therefore distinguishes executable method calls from name-only references. Heap paging carries a mutation revision; restore-safe generation stamps prevent stale handles from aliasing future allocations. Census and retaining-path queries are bounded diagnostics, not a new GC algorithm.


## Native MSBuild boundary (0.7)

`packages/msbuild/src/index.js` is browser-safe; `node.js` is the only Node backend export. Studio's three new docking tools use `MSBuildClient` against an authenticated same-origin loopback service. The service owns a bounded `NativeWorkspace` and serialized `NativeMSBuild` jobs. Process arguments, not shell commands, invoke installed `dotnet msbuild` or an owner-selected standalone engine. Project XML is never lowered into SharpForge compiler IR in this path. See [MSBuild guide](msbuild.md).

Native mode keeps disk source/metadata and dirty hash baselines separate from portable project imports. Manual native operations report their actual invocation, logs, diagnostics and artifact paths. Compilation output can enter the existing ordinary-IL inspection/debugging path, but that path retains its bounded type/instruction/BCL support. Native MSBuild does not introduce a CLR source debugger or turn browser language services into Roslyn.

Tests distinguish pure contracts, real disk/HTTP/process lifecycle with a labelled simulator, production browser UI with an explicit client double, and an independent real installed-SDK gate. A passed transport test is never treated as native semantic certification.
