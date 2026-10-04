# Debugger deoptimization of live CIL invocations

`deoptWasmFrames(vm)` forces every currently live direct-CIL invocation, including
parked scheduler contexts, to use canonical handlers for the remainder of that
invocation. It returns the number of newly marked frames; repeated calls return
zero until new invocations appear. Non-CIL inputs throw `WASM_ENGINE`.

```js
import {deoptWasmFrames} from '@sharpforge/runtime';

// At a host pause or debugger boundary:
deoptWasmFrames(vm);
// Continue with ordinary bounded slices, or an existing manual handle.
vm.runSlice({instructionBudget: 1000, timeBudgetMs: 8});
```

Both manual `runWasmSlice` and automatic call/OSR selection honor the mark.
Calling from an imported host callback lets that instruction finish exactly
once; its next instruction is interpreted. Marks do not dispose compiled
methods, cancel preparation or prevent later fresh calls from using them.
Counters and queued preparation continue normally. Suppressed instructions do
not increment automatic `selectedInstructions`, and suppressed hot edges do not
produce another OSR transition or an entry-rejection count. This API adds no new
event kind or duration metric.

The existing one-instruction bridge already keeps arguments, locals, evaluation
stacks and references in canonical frame storage. Deoptimization therefore
changes dispatch policy without copying values, replaying operations or moving
the instruction pointer. Existing GC root enumeration, managed exceptions,
instruction/stack limits and cooperative time budgets retain their outer
execution boundaries. Budget yields alone do not request deoptimization.

`CilDebugSession` marks live frames when a source, instruction, function or data
breakpoint stops execution, when exception breaking stops, and for stepping,
explicit pause and reverse-history stops. Marks are installed before deferred
host observers run. Locals and source sequence points remain inspectable at the
same stop, and resume/single-step cannot immediately reselect that invocation.
Generic runtime `onInstruction` callbacks may still inspect or pause a tiered VM
without requesting this policy; call `deoptWasmFrames` explicitly when desired.

Marks are weak, host-owned policy keyed by frame identity and its fresh
invocation id. Pooled storage reuse cannot inherit an earlier invocation's mark.
Code/report invalidation does not clear marks. Restoring a snapshot while a
marked invocation is still live transfers its mark to the restored frame with
that same id, even if the snapshot predates the stop. Repeated live restores
preserve it. Snapshots themselves contain no deoptimization state or native
objects. After `vm.stop()` or final invocation return there is no live mark to
transfer: restoring old execution then starts independently and can tier anew.
Debugger reverse-history restoration explicitly marks the resulting paused stack.

Scope: JavaScript direct-CIL Wasm only; no source-VM or Rust backend change.
Focused regression cases are authored in `tests/a05-11-wasm-deopt.test.js` for
manual/automatic selection, sequence points, live restore, parked contexts,
pool reuse, reentrant callbacks and zero-time slices. The initial integrated run
passed 165 of 170 tests, including all ten deoptimization cases. Five existing
debugger variable-edit tests exposed an outdated managed-address adapter. The
adapter now obtains the VM-owned address before selecting the requested frame;
strict owner and path validation remain enabled. A new nested-frame regression
covers editing caller arguments and locals while stopped in its callee.

After this repair, all 48 tests in the deoptimization, owned-edit and release
0.5/0.6 debugger suites passed at `9e8c0806`, using Node 24 with one test worker
and a 512 MB old-space limit. Broad platform and performance qualification is
deferred; no speedup is claimed.
