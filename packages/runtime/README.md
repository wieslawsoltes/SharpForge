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
