> **0.10 update:** [Advanced debugger and WinUI guide](advanced-debugging-winui.md) and [validation](validation-0.10.0.md) define the new symbol, async, live-editing and web-framework support; older limitations below describe the baseline unless explicitly superseded.

> **Project 7 Object-call update:** the [current Object slot contract](a05-constrained-object-slots.md) supersedes the older Object-call restrictions below. Exact `ToString`, `Equals(object)` and `GetHashCode` overrides execute through source images, reloaded source images and direct CIL, including writable struct receivers and closed source struct overrides. Its linked evidence identifies the tested revision and outstanding qualification.

# Compatibility status — 0.9.0

The [0.9 debugger guide](debugger.md) supersedes older debugger descriptions: exact source binding, opt-in entry stops, source/direct-IL conditional/function/write/instruction rules and bounded reverse state are implemented. Native/PDB/hot-reload debugging is not. See [current validation](validation-0.9.0.md). The language, native build and runtime scopes below remain bounded.

> **Scope in 0.7:** The language/runtime restrictions below describe SharpForge's portable compiler and browser VM. The separate [native MSBuild backend](msbuild.md) delegates project/solution builds, package restoration and compiler extensions to an installed SDK/MSBuild. It preserves those native semantics without extending the browser VM or its language services. Native SDK execution was not qualified in this container.

# Language/runtime compatibility retained from 0.6

Checked int32 operations, bounded primitive constant evaluation, and using resources are exercised across both engines and IL round trips. Ordinary supported DLLs have opt-in bounded reverse history and write breakpoints. These features do not establish full language, CLR or arbitrary-DLL conformance. See [0.6 notes](release-0.6.0.md).

# Executable C# profile — 0.4

**0.4 additions:** multi-file partial classes, contextual bound `nameof`, and library targets without an entry point with real static `.cctor` methods. The [project system](project-system.md) loads a bounded `.csproj`/`.slnx` subset and the [docking workspace](docking.md) provides independently placed tools, split editors and browser popouts.

**Retained 0.3 additions:** constant-case switch statements and constant/discard switch expressions, int/double casts, typed default, ??= and unchecked expression/block syntax. The new [managed IL profile](managed-il.md) separately inspects ordinary DLLs and executes an allowlisted subset; source frontend support is not implied by metadata/CIL inspection. Trusted JavaScript generators/analyzers, transactional local-type rewrites, indentation formatting and additional LSP services are available, not full Roslyn APIs.

**This is not a named C# language-version implementation.** A program compiling here does not establish that it is valid C#, or that every behavior matches the CLR. The regression suite covers selected cases, not language conformance. The normative language specification remains Microsoft's C# specification:
https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/introduction

## Implemented and exercised

| Area | Current surface |
| --- | --- |
| Entry | Library target without Main; executable top-level statements; static `void Main()` / `int Main()`; optional `string[] args` initialized empty |
| Source | Multiple files; comments/trivia; basic `using` acceptance; flattened namespace declarations |
| Declarations | Classes and partial classes with conflict diagnostics, mutable fields, static fields, auto/computed properties, private accessors, static/instance methods, constructors, overload selection |
| Method bodies | Block/expression bodies, locals, simple `var` inference, bounded primitive const-local evaluation |
| Values | Signed 32-bit integers, doubles, booleans, strings, reference objects and `null` |
| Arrays | One-dimensional allocation, array initializers, index reads/writes, length, array-only foreach |
| Objects | Construction, field initializers, object initializers, instance method calls and reference identity |
| Control flow | If/else, while, do/while, for, break, continue, return, ternary and short-circuit operators |
| Operators | Common arithmetic/comparison/bitwise operators, assignment and selected compound assignments, increment/decrement, null coalescing |
| Exceptions | Throw, rethrow, try/catch(Exception), catch-all and finally; nested protected-region unwind through managed frames |
| Diagnostics | Lexical/syntax errors, missing names/types, supported type conversion errors, selected definite-assignment and return-path errors |

## Numeric and library caveats

The integer arithmetic path includes unchecked wraparound for addition/subtraction/multiplication, truncating division, division-by-zero faults and division overflow. Positive literals outside the supported range are rejected; the special minimum signed integer spelling is supported. Checked int32 addition/subtraction/multiplication, negation and double-to-int casts are implemented, including lexical overrides and per-project defaults. Primitive constant evaluation defaults to checked and supports bound const-local patterns, but is not the complete C# constant/promotion algorithm. Compound-assignment conversions, numeric promotion and overload ranking are not complete C# algorithms.

`Math.Abs(int)` has a separate intrinsic from the double overload so the minimum signed integer faults correctly. This behavior is covered by a regression test and matches the documented Int32 overload contract:
https://learn.microsoft.com/en-us/dotnet/api/system.math.abs

The runtime provides selected Console, Math, GC, Array, Convert, int.Parse, double.Parse and string helpers. These are **small built-in implementations, not the .NET Base Class Library**. Culture, formatting, collation, exception taxonomy, conversions, static-initialization order and all overloads are not guaranteed to match .NET. `GC.GetTotalMemory` returns logical managed bytes as Int64 (`BigInt`) in both JavaScript engines; emitted calls, inferred `var` locals, and formatting preserve the Int64 value. This intrinsic does not add general source-language `long` declarations or arithmetic. `GC.CollectionCount` accepts generations 0 through 2 and reports the same full-heap collection count for each, because the collector is non-generational; other generations are rejected.

`object` assignments currently accept primitive values without a complete CLR boxing model. Namespace names are flattened, access modifiers are not fully enforced, and inheritance/type identity rules are incomplete. Using directives are consumed but do not implement complete namespace import/alias resolution. Parameters, user intrinsics and fields can expose additional name-resolution differences. These are substantive semantic limitations, not merely missing syntax. The CIL emitter inserts CLR-required `box` instructions and typed conversions, but the browser VM retains its original simplified primitive/object representation. Consequently an object-typed primitive, its equality/identity and formatting can differ between browser execution and an actual CLR. Real CIL output is not a certification of full C# or cross-runtime semantic equivalence. The independent .NET fixture suite deliberately records the exercised cases and does not claim all accepted programs match.

`ldstr` and source string constants share a VM-owned intern pool. `String(char[])` copies its input code units into a fresh string. Runtime-built strings remain distinct until passed to `string.Intern`; `string.IsInterned` probes without adding entries. `object.ReferenceEquals` compares managed reference identity. Pools survive snapshot/restore and are cleared by `stop()`, which is the current assembly-unload boundary. The optional `weakStringInterning` VM setting allows unrooted pool entries to be collected; this is an opt-in memory policy, not the CLR default. String indexing in the CIL `get_Chars` intrinsic and the source `string.get_Chars` runtime builtin returns UTF-16 code units, including individual surrogate halves. General source-language `char` syntax/indexing remains outside the frontend profile.

Source `Op.ENUM` retains framework enum type identity. Names, unknown numeric values, underlying integer widths, boxed enum identity, `Enum.ToString`, and `Enum.HasFlag` are implemented for registered framework enums and independent CIL enum metadata. Flags formatting reads `FlagsAttribute` and literal Constant rows. Framework enum locals, formatting and `HasFlag` compile through source and CIL paths. Custom C# enum declarations and general source enum casts/arithmetic remain frontend limitations; custom enum boxing/type tests use independently authored CIL fixtures. The .NET comparison fixture is `tests/fixtures/a05/enums-strings/Program.cs`, with expected output alongside it.

CIL `ldtoken` accepts type, method and field metadata tokens and creates immutable handles owned by the current VM and MethodTable registry. `Type.GetTypeFromHandle` and `Object.GetType` share cached, rooted `System.RuntimeType` objects, including canonical primitive aliases, arrays, open generic definitions and closed generic types. `Type` equality, names, generic-kind flags and type-handle round trips are runtime intrinsics; broader reflection remains outside this runtime task. Type caches survive snapshot/restore and clear at `stop()` or assembly replacement. Source `GetType`, `Name` and `FullName` have narrow compiler adapters; source `typeof` and generic syntax remain frontend limitations. The native reference fixture is `tests/fixtures/a05/tokens/Program.cs`; its optional `TOKEN_MEMBER_ORACLE` uses reflection only as a native oracle for member handles, while independent CIL tests load member tokens directly. Closed generic FullName assembly qualifiers reflect the selected runtime reference profile, not an installed host CLR version.

## Not implemented

Generics; inheritance; virtual dispatch; general interfaces beyond concrete IDisposable disposal; structs and records; indexers; init accessors; virtual/abstract properties; delegates/events/lambdas; closures; LINQ; extension methods; general recursive/type/property patterns; async/await and iterators; nullable-reference analysis; tuples; ref/out/in semantics; pointer/unsafe code; dynamic binding; attributes; reflection; Roslyn-compatible .NET source generators; preprocessor execution; complete Unicode identifier rules; interpolated/raw-string features; collection expressions; multi-dimensional arrays; exception filters; full integer/floating/decimal types; casts beyond the supported int/double conversions; complete constant semantics.

The original profile emits genuine PE/CLI assemblies with ECMA-335 CIL and can load its own canonical `SharpForge.CIL/1` profile into the browser VM. This does **not** implement an arbitrary CLR loader. There is no NuGet assembly restore/linking, general CLR type/dependency binding, Portable PDB reader/writer, native interop, threading/tasks library or arbitrary browser/DOM interop. File, network and process APIs are not exposed to managed programs. The original source-debugging `Main(string[])` receives an empty array. The separate direct-CIL path accepts explicit host arguments.

Known unsupported constructs generally emit diagnostics and block emission. This is not a guarantee that every unsupported construct is recognized cleanly or that every accepted construct has full C# semantics.

## Compiler-service boundaries

The language service supports a useful subset of completion, hovers, navigation, references, symbols, signature help and semantic classification. Symbol rename is limited to bound locals, fields and methods; type rename is rejected. Semantic tokens and signature help are simplified. There is no complete Roslyn semantic API or binary analyzer ecosystem, full formatting or refactoring suite, full MSBuild task/property-function execution or NuGet restore. The project-system package resolves a bounded project graph and `.slnx` solutions. Project references are source-combined into one supported compilation, not compiled/linked as independent assemblies. LSP adds call hierarchy and reference lenses; external-client interoperability remains unqualified.

## IDE and debugger boundaries

The IDE is an original Visual Studio-inspired workbench, not a pixel-identical Visual Studio product. Its editor uses a textarea/highlight overlay rather than the Visual Studio editor or Monaco. Syntax and gutters use a viewport index, while the full text remains in the textarea and lexing still scans the source on edits. All 25 tools are docking panels with nested splits, tabs, drag/drop, floating groups, auto-hide, saved layouts and same-origin browser popouts. Source documents have independent editor buffers and undo histories. Native Visual Studio windowing, exhaustive accessibility/touch interactions, inter-process docking and pixel-exact parity are not implemented. It does not include Git integration, designers, package management, collaboration, a general extension marketplace or a terminal. Built-in trusted JavaScript generators/analyzers are supported.

The debugger supports one managed thread in its own VM. Function/data breakpoints are reusable APIs; Studio exposes source/instruction breakpoints and right-click managed storage write breakpoints. Ordinary-IL reverse history is opt-in, bounded by count and an estimated container budget, with heap/unwind/GC state restoration. These are not hard total-process memory limits. There is no native or CLR attach, async task inspection, hot reload/edit-and-continue, arbitrary function evaluation, optimized-code debugging, native memory editing or full Visual Studio/DAP compatibility. Reverse stepping restores recorded internal state, not time, filesystem/network effects or browser state.

## IL interoperability boundary

The default reference profile targets `System.Runtime`/`System.Console` version 8.0.0.0; the alternative `mscorlib4` profile targets legacy reference identities. The emitter produces standard type/field/method/parameter/member-reference/local signatures and catch clauses. The default artifact includes a `#SF` metadata stream for source points, local scopes, stable original-method identities and IL-span fusion boundaries. It contains no executable VM code and is not required by a native CLR, but is required by the original canonical-profile browser loader. The separate direct-CIL interpreter does not require it.

`embedSources:false` preserves this profile and allows source-free browser execution. `includeDebug:false`/CLI `--native-only` omits `#SF` and cannot use the original source-debugging VM; supported bodies can execute through the separate direct-CIL interpreter. Arbitrary IL instruction encodings, third-party references, generic signatures, virtual/interface dispatch, value types, unsafe operations, filters, managed pointers and native imports are outside the original canonical profile and must not be assumed loadable there. The separate direct-CIL profile has selected finally/fault and managed-reference support, not a complete CLR implementation. See [managed IL](managed-il.md) for its distinct contract.

The strict loader checks exact canonical re-emission, including generated scaffolding and metadata. Its verifier is not a replacement for the CLR's verifier or an audited security proof. No general `ilasm` assembler, PDB support, strong-name signing, multi-module linking or ReadyToRun/native code emission is present.
