> **0.10 update:** [Advanced debugger and WinUI guide](advanced-debugging-winui.md) and [validation](validation-0.10.0.md) define the new symbol, async, live-editing and web-framework support; older limitations below describe the baseline unless explicitly superseded.

# Managed DLL tooling — 0.6.0 contract

## Three separate levels

1. **Inspection:** `AssemblyInspector` reads bounded PE/CLI structures, metadata tables/heaps, type/member declarations, signatures, method bodies, CIL, exception clauses and descriptors for resources/custom attributes. `formatAssembly`/Studio show assembly and method IL with resolved token descriptions. Generic signatures, MethodSpec/TypeSpec, pointers/function pointers and exception filters can be inspected even when execution is unavailable. Invalid/unsupported methods report a status rather than inventing a body. Resource bytes and all custom-attribute argument payloads are not decoded/exported. Native/mixed-mode code is not disassembled into machine instructions.
2. **Original profile execution/debugging:** `loadAssembly` + `VirtualMachine` retain strict canonical `SharpForge.CIL/1` verification and `#SF` source maps. Existing source breakpoints, watches and snapshots use this path. It does not silently become an arbitrary loader.
3. **Direct managed IL execution and instruction debugging:** `CilVirtualMachine` independently interprets a preflighted reachable subset without `#SF`. A library needs an explicit static MethodDef, name or token; a valid PE entry point is the default when present. No source recompilation occurs. Unsupported calls/dependencies/pointers/generics/filters/native methods are rejected, not stubbed with successful results.

The standard opcode decoder is broader than the executable-opcode allowlist. Successful decoding is not permission to execute, and successful stack-height preflight is not full CLR type verification. Runtime guards still reject invalid combinations and unverified virtual overrides.

## Supported execution building blocks

The direct engine covers i4/i8 (BigInt), r4/r8, signed/unsigned/checked arithmetic and conversions, primitive host arguments and returns, locals/arguments, branch/switch, same-assembly calls, static initialization, objects/fields, one-dimensional arrays, selected primitive boxing/casts and managed byrefs. Narrow storage truncates and loads sign/zero-extend; float storage rounds to single precision. Catch/finally/fault unwinding is implemented; filters are not. Nested unwind continuations and lexical rethrow handlers are preserved. `sizeof`, `cpobj` and `unbox` support only fixed-width primitives; arbitrary struct layout/native addresses are rejected. `unbox` returns a managed address into its original box, and GC traces that owner.

A fixed intrinsic whitelist provides selected Console, Object, Exception, String, Math, Convert, numeric Parse and GC methods with checked signatures. This is not a full BCL implementation; culture, numeric formatting/conversion edges and Unicode behavior are constrained by the JavaScript implementation. Arbitrary native calls, reflection emit, threads/tasks, files, network, process and DOM access are not available. External dependent assemblies are not loaded. Even an ordinary C# library can require unsupported generic types, helpers or BCL calls.

Defaults: 20,000,000 guest instructions, 512 frames, 65,536 stack values per frame, 1,000,000 output characters, plus a 32 MiB logical managed-heap byte budget and a one-million-element array limit. Limits can be configured by the trusted host. `runSlice` is cooperative; hosts must enforce wall-clock/message limits and terminate workers as needed. This preview has not passed an independent security audit and is not a production sandbox for hostile DLLs.

Host values support the implemented scalar/array types. Use decimal strings for exact long/ulong arguments; results retain BigInt in the module API and are strings in JSON reports. Boolean results are booleans; uint/ulong results are unsigned. A default entry `Main(string[])` gets an empty array when host arguments are omitted. In Studio, explicitly supply `[[]]` for that signature or `[["one","two"]]`. Instance host invocation and arbitrary object marshaling are not implemented.

## Editable IL

`formatILDocument(bytes)` produces the **SharpForge.IL/1** dialect. The embedded `.image` base64 scaffold supplies existing PE metadata and resources; `.method` declarations supply every editable CIL body. `assembleILDocument(text)` requires every original IL body exactly once and rebuilds it from text. It never executes an omitted old body from the scaffold. Label fixups, operand ranges, maxstack, locals/initlocals and exception ranges are checked. Missing/duplicate bodies and unknown opcodes/labels fail.

The assembler appends new code, updates method RVAs and section/image sizes, strips Authenticode/strong-name signatures and invalidates old `#SF` debug maps. Tokens, local-signature declarations and strings must refer to existing metadata. Arbitrary new methods/types/strings, metadata editing, branch relaxation, every PE section layout and full ilasm grammar are not supported. Signed input becomes unsigned output and requires any subsequent re-signing to be handled by an appropriate external trusted tool.

`formatAssembly` is a human-readable inspection listing, not the editable dialect. Use **Edit IL** or CLI `il-export` for round-tripping. UI **Assemble + run** always runs the newly assembled bytes; switching views while editing requires assembly first.

## C# reconstruction

`decompileMethod` performs conservative stack-to-C# reconstruction for the supported subset and retains evaluation ordering through temporary variables. Its `{complete, language, diagnostics, source}` result must be checked. EH, unsupported control flow/type semantics and other unsupported instructions produce full method IL and a diagnostic. `decompileAssembly` aggregates each method's reconstruction or IL fallback. It does not recover original source, comments, original local names, project files or full C# constructs. The IL path is executable for the allowed VM subset even when high-level reconstruction is unavailable.

## APIs and commands

```js
import { AssemblyInspector, formatILDocument, assembleILDocument,
         decompileMethod, verifyCilAssembly } from '@sharpforge/cil';
import { CilVirtualMachine } from '@sharpforge/runtime';
const inspector = new AssemblyInspector(bytes);
const listing = inspector.summary();
const edited = formatILDocument(bytes).replace(': add', ': mul');
const artifact = assembleILDocument(edited);
const vm = new CilVirtualMachine(artifact.bytes, { methodToken: 'Add', arguments: [6, 8] });
console.log(vm.run().returnValue); // 48 for examples/managed/Arithmetic.dll
```

CLI commands: `inspect`, `verify`, `invoke`, `decompile`, `il-export`, `il-assemble`, `disasm`, `exec`. `--method` accepts a unique name, `Type::Name` or hex MethodDef token. `--args` is a JSON array; ambiguity requires a token. `exec --managed-il` explicitly chooses direct CIL for a profiled input. A method returning int controls `exec`'s process exit code; successful `invoke` returns process status zero and prints the method result.

## References and validation

Opcode/metadata design follows ECMA-335, with Microsoft opcode documentation used for storage-width semantics. Implementation coverage is bounded by the tests and allowlists, not by those standards' full scope.

- ECMA-335: https://ecma-international.org/publications-and-standards/standards/ecma-335/
- CLR opcode definitions: https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Reflection/Emit/OpCodes.cs
- Narrow local storage: https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.opcodes.stloc_1
- Indirect small-integer loads: https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.opcodes.ldind_i2

New fixture evidence: `tests/managed-fixtures.js`, `tests/managed-il.test.js`, `tests/browser_managed_test.py`. [Validation report](validation.md) distinguishes these hand-authored fixtures from independent CLR and third-party DLL validation.

The 0.5 hand-authored `PrimitiveAddresses.exe` returns 52 after boxing/unboxing, collection, managed address writes, primitive copy and sizeof. `Finally.exe` demonstrates nested cleanup without #SF. Direct stepping/breakpoints use `CilDebugSession`; see [debugger](debugger.md) and [protocols](protocols.md).

## 0.6 replay and checked/disposal support

Checked frontend operations lower to `add.ovf`, `sub.ovf`, `mul.ovf` and `conv.ovf.i4`. Concrete IDisposable resources emit InterfaceImpl metadata and finally regions; this does not enable general interface-variable dispatch. The selected unchecked non-finite/out-of-range floating-to-int32 profile returns Int32.MinValue consistently; do not treat unspecified CLI conversion cases as universal cross-CLR promises.

`CilVirtualMachine.snapshot()`/`restore()` support trusted same-instance state snapshots, including heap roots and exception continuations. `CilDebugSession` layers bounded opt-in instruction history and generation-checked write breakpoints on top. Snapshot budgets are estimates, not a sandbox memory proof. Native external effects, threads, arbitrary object layouts and unknown dependencies are still unsupported.
