# @sharpforge/runtime

Two standalone interpreters: `VirtualMachine` for the source-debugging profile and `CilVirtualMachine` for bounded direct managed CIL without #SF. Both share a precise managed heap with stable handles, optional generational and incremental collection, spatial backing storage, and explicit lifetime services. The direct engine remains a constrained allowlisted subset.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/runtime';
```

`ManagedHeap.createHandle(value, {weak: false})`, `getHandle(handle)` and `releaseHandle(handle)` manage explicit host roots. Weak handles do not retain targets. Reference identity generations prevent stale-handle reuse; the separate `gcGeneration` field tracks collector generations 0, 1, and 2. See [the heap embedding contract](../../docs/gc-heap.md), [lifetimes](../../docs/gc-lifetime.md), [storage](../../docs/gc-spaces.md), and [diagnostics](../../docs/gc-diagnostics.md).

`DebuggerMemoryScope(heap, {maxReferences, maxTransferBytes})` exposes bounded
primitive/enum payload windows through counted pins and opaque references. Its
`open`, `read`, `write`, `release`, `afterRestore`, and `dispose` lifecycle is
documented in [pinned debugger memory](../../docs/gc-debugger-memory.md); strings and
frozen payloads are read-only, and managed reference slots are not byte-addressable.

`delegateMethodPointer(cilVM, token)` is the public factory for a verified native
managed-method pointer. It resolves an actual MethodDef/MemberRef target in that
VM's verified execution graph and returns an immutable pointer carrying the VM
owner identity. Invalid metadata or an unverified target throws; native delegate
construction rejects foreign or forged pointer ownership. The value contains no
host address. Source-image method indices remain a separate source execution
contract and are not accepted by this native factory.

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## 0.10 integration

This package participates in Portable PDB symbols, cooperative async/logical-thread execution, managed Hot Reload, explicit evaluation, guarded instruction relocation and the code-first WinUI web profile. See the source distribution `docs/advanced-debugging-winui.md` for exact semantic limits; no native CLR/WinRT or full Visual Studio compatibility is implied.

`VirtualMachine` and `CilVirtualMachine` support `runAsync()` and `{virtualTime:true}` for deterministic tests. `vm.platform.scene()` provides the current managed UI scene. The scheduler parks managed frames and uses cooperative contexts sharing a precise managed heap, not OS threads.

## 0.13 managed collections and playback

Both engines dispatch the closed BCL collection/text contracts through managed heap state. Interpolated formatting is invariant and bounded. ManagedPlatform owns a shared data-only animation clock; headless applications advance it explicitly, while Studio supplies a timer that freezes at debugger stops. Automatic clocks are not an implicit timer inside a synchronous `run()`. Compatible snapshots retain collection and timeline state; native CLR behavior is not implied.
