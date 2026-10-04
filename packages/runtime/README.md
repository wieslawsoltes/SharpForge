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

## Isolated invocation and launch context

`ManagedInvocationSession(artifact, {backend: 'source' | 'cil', ...runtimeOptions})`
owns a separate VM, heap, static state and scheduler. `invoke(name, {arguments,
signal})` invokes a static method after initialization and returns its converted
value, stdout, fault, duration and source location. Calls within a session are
sequential; `dispose()` cancels work. A cancelled or fatally faulted session cannot
be reused. This is a bounded execution API, not unrestricted CLR reflection.

`withSourceLaunchArguments(image, stringArray)` returns a new source image with
arguments bound into the compiler-generated startup method, including both the
legacy empty-array bootstrap and the current forwarded string-array parameter. Static initialization
and async Main completion remain in the startup. It accepts source images decoded
by `loadAssembly` and can run before CIL emission. The original image is unchanged;
unrecognized argument bootstrap patterns throw. Parameters are limited to 4096
strings and 131072 UTF-16 units, without NUL characters. Prefer the `programArguments` runtime option described above for new hosts; this
overlay API remains available for immutable source-image preparation. Direct CIL
custom-method launches retain their existing `arguments` option.

The additional `System.Environment.GetEnvironmentVariables()` and
`System.Environment.CurrentDirectory` contracts read the same per-session environment
snapshot and the explicit `workingDirectory` option (`currentDirectory` alias).
Legacy `environmentVariables` input is accepted only when canonical `environment`
is absent. No operating-system environment or current directory is inherited or mutated. The deterministic defaults are an empty environment and
`/`. Variable lookup uses ordinal case-sensitive names. `GetEnvironmentVariables`
returns a separate mutable managed `IDictionary`; modifying it affects only that
dictionary. See the BCL core README for exact bounds and collection support.

## Separate project assemblies

`createProjectAssemblyInspector(assembly, {dependencies})` verifies an explicit
canonical SharpForge PE dependency graph and supplies one execution view to the
existing direct CIL VM. The source VM consumes `loadProjectAssembly(...).image`
from `@sharpforge/cil`. Both keep independent per-session state and preserve
assembly-qualified types and source maps. See [PROJECT-ASSEMBLIES.md](PROJECT-ASSEMBLIES.md)
for the API, admission rules, limits and update boundaries.
