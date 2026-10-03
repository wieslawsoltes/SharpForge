# SharpForge IL backend — 0.2.0

## Contract and design choice

The transport/storage/build artifact is a **real ECMA-335 PE/CLI assembly**. Execution in the JavaScript runtime uses a predecoded representation; IL decoding is performed once, not in the hot instruction loop. `compile()` retains the existing frontend/analysis contract. `compileToIL()` adds the PE backend; Studio/CLI build and execution use that path by default.

This is not custom JSON renamed `.dll`, a bundle containing the old executable IR, JavaScript generated with `eval`, or a Roslyn/.NET wrapper. Executable instructions are genuine CIL method bodies. Independent Mono/.NET WASM execution tests exercise 46 emitted assemblies; the qualified scope is documented in `validation.md`.

```text
Source snapshots → parser/binder → existing internal lowering IR
                                           ↓
                                 typed CIL stack analysis
                                           ↓
                    real CIL + CLI metadata/signatures/EH → PE DLL
                                           ↓ load once in browser
                    bounded PE reader → metadata reader → IL decoder
                                           ↓
                    canonical-profile verifier → original VM ops
                                           ↓
                        original dispatch / frames / managed GC
                                           ↕
                        original source debugger + IL offset map
```

## Package modules

`@sharpforge/cil` depends only on `@sharpforge/bytecode`, not on the compiler, runtime or UI. `binary.js` provides bounded readers/writers and compressed indices. `metadata.js` implements table schemas, coded indices, strings/user strings/blob/GUID heaps and signatures. `pe.js` emits PE32/CLI and reads PE32/PE32+ headers and fat method/EH sections. `opcodes.js` encodes/decodes actual opcodes and validates branch boundaries. `analysis.js` computes abstract stack types for the emitted IR. `emitter.js` lowers typed CIL and links metadata. `loader.js` reconstructs supported executable semantics from IL and validates the exact profile. `disassembler.js` resolves metadata operands and formats an inspection listing.

Each is an ordinary reusable ESM source file. No runtime dependency on .NET, Roslyn, a service or an external npm library is introduced.

## PE and metadata details

The emitter writes DOS/PE/COFF headers, one aligned `.text` section, a CLI header with ILOnly flag and a managed entry token. Method bodies use fat headers with maxstack/local signatures; protected regions use actual catch-clause EH sections. Module/type/field/method/parameter/member-reference/local-signature/assembly-reference metadata is linked by real tokens.

The tables stream is `#~`. Other standard heaps are `#Strings`, `#US`, `#GUID` and `#Blob`. The index writer chooses narrow or wide heap/table/coded indices, with tests crossing the 64 KiB heap boundary. The PE timestamp is deterministic, and the MVID is derived from emitted method bytes. This derivation is not cryptographic signing or an authentication scheme.

Default framework references are `System.Runtime` and `System.Console` 8.0.0.0 with the expected public-key token. The optional `mscorlib4` reference profile changes external reference identities; legacy-host execution is not validated. Runtime configuration generation targets Microsoft.NETCore.App 8.0.0 with `LatestMajor` roll-forward. No strong name, native entry trampoline, multi-module linking, ReadyToRun body or general `.il` assembler is implemented.

## Typed lowering and runtime normalization

The internal VM has three-word instructions and a few non-CLI stack conventions. Assignment stores leave a value; void calls produce a null placeholder; the operand stack and parameters use uniform VM slots. Those conventions cannot simply be written as CLR opcodes.

The CIL backend analyzes reachable stack types and emits required `dup`/local spills, argument prologues, conversions, boxing, placeholder cleanup and declared-type stores. It preserves floating-point literals such as `7.0`, uses signed integer comparisons and floating unordered comparisons where required, and emits managed branch/leave/return behavior around exception regions. Scratch locals have actual CLI signatures.

Construction uses legal CLR constructor wrappers with `System.Object::.ctor`, separate field-initialization/body helpers and a compiler-generated raw-allocation constructor marked by a compiler-generated profile type. This accommodates the VM's separate allocation/initialization stages. The browser loader validates the emitted scaffolding and fuses supported instruction spans back to the existing VM operations. It does not execute extra helper instructions in its hot loop.

The same decoded instruction count and managed collection count are checked for the benchmark fixtures. This preserves the current VM's performance and semantics for its supported profile, not complete CLR semantics. Primitive/object boxing, culture-sensitive library behavior, static initialization and other documented C# limitations still require compatibility work.

## The `#SF` stream

The extra profile/debug metadata stores format version, source paths/text (optional), local names/scopes, original method identities, sequence points and IL offset/length spans used for instruction fusion. It contains **no original VM opcode arrays or executable constant stream**. Types, method/local signatures, field layout, real instructions and exception clauses are recovered from standard metadata/CIL. The loader never recompiles embedded source. A source-free DLL is tested both at the core API and in the browser IDE.

`embedSources:false` removes source text but retains the mappings needed by this loader. `includeDebug:false` removes `#SF` altogether for native-only output. Native CLR execution does not use that stream, but the browser profile currently requires it. It is **not a Portable PDB**, an arbitrary-assembly interchange contract, or an encrypted/source-protection mechanism.

## Validation and loading

`loadAssembly(bytes)` applies bounded PE and metadata parsing, signature/token checks, real CIL decoding, supported external-method resolution, branch/handler validation and profile-span validation. It reconstructs a VM image, re-emits it canonically and compares the complete output against the supplied binary. This catches modified opcodes, scaffolding, metadata or unsupported instruction patterns rather than accepting mappings as trusted executable instructions.

Exact canonical equality is intentionally conservative. Semantically equivalent IL from another producer, an altered MVID, a rewritten metadata layout or a stripped profile stream can fail. This is a supported-producer profile, not general ECMA-335 verification or arbitrary Roslyn/NuGet assembly import. Canonical verification also deliberately adds first-load cost. It is not optional on the browser path and is not an authentication/security proof.

The default binary cap is 64 MiB. Decode/load work executes in the runtime worker, away from the editor. Hosts still need source/worker/process limits: PE metadata, decoded code and debugger/source maps live in the JavaScript heap outside managed allocation accounting.

## Public API

```js
import { compile, compileToIL } from '@sharpforge/compiler';
import {
  emitAssembly, emitAssemblyDetailed, loadAssembly,
  disassembleAssembly, formatAssembly, createRuntimeConfig
} from '@sharpforge/cil';

const compiled = compileToIL('Console.WriteLine(42);', {
  name: 'Example', framework: 'net8',
  includeDebug: true, embedSources: true
});
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
const bytes = compiled.assembly; // Uint8Array
const module = loadAssembly(bytes); // reusable VM image, treat as immutable
console.log(module.il.loadMs, module.il.decodeMs, module.il.verificationMs);
console.log(formatAssembly(bytes));
console.log(createRuntimeConfig());

// Backend can be used separately from analysis:
const frontEnd = compile('Console.WriteLine(42);');
if (!frontEnd.success) throw new Error(JSON.stringify(frontEnd.diagnostics));
const emitted = emitAssemblyDetailed(frontEnd.image, { framework: 'net8' });
console.log(emitted.metrics); // emitIlMs, assemblyBytes, ilBytes, metadataBytes, methods
```

`compileToIL` returns the normal success/diagnostics/image/symbol/reference/metrics fields plus `assembly` and `format:'cil'`. Source errors block output; backend profile errors become diagnostic `SF3001`. Low-level emitter/loader APIs throw `CilError`. `emitAssembly` returns only bytes; `emitAssemblyDetailed` also returns debug/maps/metrics/framework. `disassembleAssembly` returns structured metadata and actual IL instructions. `formatAssembly` is a human-readable **inspection listing**, not a lossless `ilasm` source generator.

`new VirtualMachine(bytes)` and `new DebugSession(bytes)` load in their constructors. Call `loadAssembly()` once and reuse the resulting module for many independent VM instances to avoid repeat loading. VM state, statics, heap and history are per instance.

## IDE and CLI behavior

Ordinary diagnostic/completion requests use only frontend analysis; there is no PE emission per edit. Builds emit/copy IL bytes. A runtime-worker launch receives the DLL, validates it and retains one decoded module; subsequent identical bytes reuse it. The byte comparison and fresh VM construction still cost time, but no per-instruction IL decoder is introduced.

File exposes DLL import/export, `.runtimeconfig.json`, IL listing and explicit legacy IR export. Import validates a DLL before replacing the workspace. A pristine imported assembly executes its actual bytes without source rebuilding; modifying displayed source switches back to a source build. Source-free imports show a placeholder and can execute without source. Save the original imported DLL independently—source/project persistence is not executable persistence.

Disassembly switches between actual CIL and decoded IR. Call-stack frames report MethodDef token/IL offset alongside source coordinates. Existing breakpoints, conditions, stepping, watches, object inspection, exception stops and bounded reverse snapshots remain VM features. No CLR attach or Portable PDB interoperability is implied.

CLI defaults:

```sh
node apps/cli/main.js compile examples/arrays/Program.cs -o App.dll
node apps/cli/main.js exec App.dll
node apps/cli/main.js disasm App.dll
node apps/cli/main.js run examples/arrays/Program.cs
node apps/cli/main.js compile examples/arrays/Program.cs --no-sources -o NoSource.dll
node apps/cli/main.js compile examples/arrays/Program.cs --format ir -o Legacy.sfb.json
```

## Reference standards

ECMA-335, partitions II (metadata) and III (CIL instruction set):
https://ecma-international.org/publications-and-standards/standards/ecma-335/

Microsoft PE/COFF specification:
https://learn.microsoft.com/en-us/windows/win32/debug/pe-format

Microsoft System.Reflection.Emit.OpCodes reference:
https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.opcodes

These are format references, not claims that this implementation passes complete CLI conformance.
