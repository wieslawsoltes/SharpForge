# @sharpforge/runtime

Two standalone interpreters: `VirtualMachine` for the original source-debugging profile and `CilVirtualMachine` for bounded direct managed CIL without #SF. Both share the explicit non-moving mark-and-sweep heap. The direct engine is a constrained allowlisted subset, not a complete CLR loader/type verifier or full BCL.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/runtime';
```

`ManagedHeap.createHandle(value, { weak: false })`, `getHandle(handle)` and `releaseHandle(handle)` manage explicit host roots. Weak handles do not retain targets. Collection reuses marking scratch storage and reports trace/pause counters. These reference-generation checks are not a generational GC.

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## 0.10 integration

This package participates in Portable PDB symbols, cooperative async/logical-thread execution, managed Hot Reload, explicit evaluation, guarded instruction relocation and the code-first WinUI web profile. See the source distribution `docs/advanced-debugging-winui.md` for exact semantic limits; no native CLR/WinRT or full Visual Studio compatibility is implied.

`VirtualMachine` and `CilVirtualMachine` support `runAsync()` and `{virtualTime:true}` for deterministic tests. `vm.platform.scene()` provides the current managed UI scene. The scheduler parks managed frames and uses cooperative contexts sharing a precise managed heap, not OS threads.

The runtime `maxInstructions` option limits executed instructions, including repeated
loop iterations. It does not set the number of instructions permitted in a decoded
method or change exception-region validation bounds. Hosts that need tighter CIL
decoding limits can supply an `AssemblyInspector` constructed with its own limits;
the standalone `verifyCilAssembly` options continue to control structural admission.

## 0.13 managed collections and playback

Both engines dispatch the closed BCL collection/text contracts through managed heap state. Interpolated formatting is invariant and bounded. ManagedPlatform owns a shared data-only animation clock; headless applications advance it explicitly, while Studio supplies a timer that freezes at debugger stops. Automatic clocks are not an implicit timer inside a synchronous `run()`. Compatible snapshots retain collection and timeline state; native CLR behavior is not implied.

## Program arguments and application environment

Both JavaScript interpreters accept `programArguments`, a flat array of strings for
`Main(string[])` or top-level `args`. A parameterless entry point receives no method
parameters even when the application has program arguments. The compiler's startup
wrapper forwards the array after module initializers and preserves async Main's
await and integer exit-code behavior.

```js
const options = {
  programArguments: ['input.txt', '--verbose'],
  environment: { MODE: 'preview', EMPTY: '' }
};
const vm = new VirtualMachine(compiled.image, options);
const result = await vm.runAsync();
```

`CilVirtualMachine` keeps its separate `arguments` option for the raw parameter
vector of a selected `methodToken`, for example `{ methodToken: 'Add', arguments:
[19, 23] }`. Supplying nonempty `programArguments` with an explicit method token or
raw argument vector fails with `PROGRAM_ARGUMENTS_METHOD`; neither interpretation
silently replaces the other. Existing raw string-array parameters retain their
nested shape, such as `{ arguments: [['one', 'two']] }`.

`System.Environment.GetEnvironmentVariable(string)` reads the current runtime's
copied environment and returns a string or `null` for a missing name. Empty values
remain empty strings. Names are case-sensitive, and a null name throws a managed
`ArgumentNullException`. Values are read-only launch configuration; no process,
operating-system, user or machine environment is inherited or changed. Mutation
and OS-target overloads have no registered contract and fail source/CIL validation.
The BCL module uses the existing A07 extension reservation; all released contract
and runtime builtin IDs keep their meaning.

The exported `runtimeLaunchCapabilities` reports `{ arguments: true, environment:
true, environmentMutation: false }` for these two interpreters. It makes no claim
about native/Wasm hosts. Studio's worker returns this record after a successful
launch. Hosts targeting another engine must supply its actual capability record.

The exported validators `validateProgramArguments` and
`validateLaunchEnvironment` copy/freeze their results. `normalizeRuntimeLaunchOptions`
applies them to runtime options without rewriting raw method arguments. Invalid
input throws `RuntimeLaunchError` with a stable `code`: `PROGRAM_ARGUMENTS`,
`LAUNCH_ENVIRONMENT`, `METHOD_ARGUMENTS`, `PROGRAM_ARGUMENTS_METHOD`, or
`PROGRAM_ENTRY_SIGNATURE`. Limits are exported as `runtimeLaunchLimits`:

| Input | Bound |
| --- | --- |
| Program argument count | 1,024 strings |
| Individual program argument | 65,536 UTF-16 code units |
| Total program argument content | 1,048,576 UTF-16 code units |
| Environment variables | 256 own name/value pairs |
| Environment name | 256 code units, `[A-Za-z_][A-Za-z0-9_]*` |
| Environment value | 65,536 UTF-16 code units |
| Total environment names and values | 1,048,576 UTF-16 code units |

Null characters are rejected. Environment input must be a plain or null-prototype
record; normalized storage has a null prototype. Construction does not retain
mutable host arrays/records. Managed arguments remain rooted through allocation,
GC, async entry frames, and debugger snapshots. Runtime environment values are
host configuration and are not copied into snapshot or exported profile payloads.

The behavior follows the single-string process lookup contract documented by
[Microsoft](https://learn.microsoft.com/en-us/dotnet/api/system.environment.getenvironmentvariable?view=net-10.0).
The focused source, emitted CIL, independent CIL and production-worker tests are
`tests/a19-runtime-*.test.js`; they do not claim native CLR execution parity.
