# @sharpforge/debugger

VM source-level debugging, breakpoint APIs, stepping, watches and bounded snapshot replay.

Version 0.9.0 · MIT · ES modules.

This package is part of SharpForge, an executable C# subset toolchain. It is not full C#/CLR/Visual Studio conformance. The source release includes architecture, API examples, compatibility boundaries and tests.

```js
import * as api from '@sharpforge/debugger';
```

Install its declared sibling packages together. npm publication is not part of this release. See the root project README and docs/embedding.md for integration.

## Ordinary DLL debugging in 0.5

`CilDebugSession(bytes,{methodToken,arguments})` debugs supported ordinary CIL without #SF. `instructionReference(token,offset)` supplies exact instruction breakpoint addresses. API: setInstructionBreakpoints, disassemble, runToInstruction, setFunctionBreakpoints, start/resume/pump/runUntilStop, stackTrace/locals/evaluate/setVariable, pause/stop. Direct stepping is instruction-based with frame-depth next/out; use `{recordHistory:true}` to enable bounded `stepBack()` / `reverseContinue()`. Watches never call computed getters. `DebugSession` remains the source-map/snapshot engine and adds runToCursor and generation-aware setDataBreakpoints.

## 0.6 reverse and storage APIs

`CilDebugSession(bytes,{recordHistory:true,maxHistory:128,maxHistoryBytes:8388608})` records same-VM state before instructions. It restores frames, stacks, locals, heap, statics, buffered output, pending exceptions/finally continuations and hit counts. Budgets cap snapshot count and estimated storage, not exact JS/process memory. Large snapshots can be dropped; external callbacks cannot be undone. No native or CLR process attachment.

`dataBreakpointInfo({frameId,name})` or `dataBreakpointInfo({reference,name})` returns an expiring storage `dataId`. Pass it to `setDataBreakpoints([{dataId,condition,hitCondition}])`. Supported stores include args/locals/statics/fields/arrays/boxes. Only writes are supported; frame and allocation generations are checked. `collect()` records a separate undoable GC checkpoint when history is enabled.

## 0.8 source breakpoint identity

`remapSourceBreakpoints(before, after, breakpoints)` retains line anchors across a source revision, and `sourceBreakpointAt(requested, bound, displayedLine)` resolves a relocated gutter point to its original request. Bound session points retain `requestedLine` separately. Unchanged source breakpoint configurations keep stable hit counters across live replacement; changed conditions/hit rules deliberately reset counters. These utilities do not provide Portable PDB/native process debugging.

## 0.9 exact location and rule APIs

`SourceBreakpointIndex` indexes immutable compiled statement spans and method boundaries. Source and direct-CIL sessions expose `breakpointLocations`, typed signature function breakpoints, `conditionMode: "whenChanged"`, `oneShot`, global `setBreakpointsEnabled`, and `setExceptionBreakpoints({mode,rules:[{name,mode}]})`. Source data IDs are also exposed through `dataBreakpointInfo` / `setDataBreakpoints`. Reverse Continue restores actual recorded stops and their compatible condition/hit-count observations.

`start()` retains explicit API entry-stop compatibility; use **`start(false)`** for F5-style run-to-breakpoint. Cooperative hosts call `pump()` with bounded budgets. Source history defaults off (64 snapshots/8 MiB estimated budget when enabled); direct-IL history defaults off (128/8 MiB). The Studio enables history explicitly. Frame/heap descriptors expire; snapshots belong to one VM and cannot undo external effects. A caller's selected frame does not change the real executing instruction.

## 0.10 integration

This package participates in Portable PDB symbols, cooperative async/logical-thread execution, managed Hot Reload, explicit evaluation, guarded instruction relocation and the code-first WinUI web profile. See the source distribution `docs/advanced-debugging-winui.md` for exact semantic limits; no native CLR/WinRT or full Visual Studio compatibility is implied.

`DebugSession` and `CilDebugSession` expose `setNextStatement(target)`, `gotoTargets(target)`, `applyChanges(imageOrAssembly, options)`, `evaluateFunction(expression, options)`, `threads()`, `parallelStacks()` and `freezeThread(...)`. Effectful evaluation requires `allowSideEffects:true`; `commit:false` previews with managed rollback. Load matching Portable PDBs using the direct-CIL session. Only compatible body updates and validated instruction targets are accepted.
