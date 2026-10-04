# Manually selected Wasm runtime bridge

This SF-A05-T11.5 increment connects the existing guarded encoder to direct-CIL
frames, scalar storage guards and canonical runtime helpers. It adds three
named `@sharpforge/runtime` APIs:

```js
const handle = await prepareWasmMethod(vm, vm.top.method);
try {
  while (vm.state === 'ready' || vm.state === 'running') {
    runWasmSlice(vm, handle, {instructionBudget: 15000, timeBudgetMs: 8});
  }
} finally {
  disposeWasmMethod(handle);
  vm.stop();
}
```

`prepareWasmMethod(vm, method = vm.top?.method, options = {})` compiles one
actual closed method object without executing it. It uses the existing
[eligibility analysis](wasm-ir-eligibility.md) and
[binary encoder](wasm-binary-encoder.md), accepting their `maxMethodInstructions`,
`maxAnalysisSlots` and `maxBytes` options. It returns a frozen opaque handle
with diagnostic `methodToken`, `name` and `byteLength` fields. Copies of those
fields are not handles. Preparation does not install code on a VM or frame.

`runWasmSlice(vm, handle, options = {})` uses the same slice options and returns
the same VM state as `vm.runSlice`. Only frames with the selected actual method
identity use the compiled entries; other methods, including callees and type
initializers, execute their canonical handlers. Each entry executes exactly one
CIL instruction. The shared slice/step envelopes retain scheduler turns,
instruction/time/stack budgets, initializers, faults, debugger callbacks,
profiling, write notifications and final frame retirement. A paused VM follows
the ordinary slice contract: the host explicitly resumes it before another
slice. This API supplies its own step executor; ordinary `vm.step` and
`vm.runSlice` retain their existing custom-step behavior.

`disposeWasmMethod(handle)` drops its module and metadata references. It returns
true once, then false. Hosts should dispose handles they no longer use. There
is no automatic method cache or threshold policy. Neither VM options nor the
behavior of ordinary `vm.run` changes after preparing a handle.

## Ownership and instruction boundaries

Handles belong to one VM, inspector, heap, verifier report, code epoch and
method/body/signature context. Restore, stop, code invalidation or body/report
replacement make them unusable. In-place semantic metadata edits must use the
existing explicit code invalidation/reverification contract. A preparation
that completes after stop, restore or an edit rejects instead of publishing
an outdated handle. Preparing again is explicit; no background work retries.

New compiled slices and disposal reject while any CIL slice or instruction is
active, including host callbacks during ordinary interpreted execution. Handle
checks run again after debugger callbacks, before advancing an instruction's
counter or PC. Rejection never replays a partially executed instruction.

Runtime imports hold the current frame only during the exported instruction
call. They check frame identity, method and PC, then clear all active references
in a finally block before pooled frame storage can be reused. Native arithmetic
guards run before pop imports and use the shared scalar carrier/width checks.
A failed guard, unknown stack shape or differing canonical handler keeps the
operation on the interpreter path.

Allocation, field, array and call imports invoke the same decoded handlers as
the CIL interpreter. Operands therefore retain existing root, bounds, covariance,
store, GC and `onWrite` behavior. This bridge creates no alternative heap,
linear-memory references or independent write barriers. Frames and snapshots
contain no module, compiled function, active import context or handle. A snapshot
can resume after restore with a newly prepared handle or the ordinary interpreter.

## Diagnostics and scope

Ownership/lifecycle failures are host TypeErrors with codes `WASM_ENGINE`,
`WASM_HANDLE`, `WASM_OWNER`, `WASM_STALE`, `WASM_DISPOSED` or `WASM_REENTRANT`.
Eligibility rejection retains its explicit `reasons` array; unavailable or
denied compilation retains the encoder's `WASM_UNAVAILABLE`/`WASM_COMPILE`
diagnostics. Managed faults from executed instructions follow normal CIL fault
and debugger dispatch. Explicit API and slice-preflight checks occur outside
that slice's managed-fault conversion. Errors left uncaught by an existing
host callback retain the ordinary callback error behavior.

Focused tests cover actual native arithmetic, rooted field/array writes under
instruction-by-instruction collection, pooled call returns, debugger pause,
snapshot replay, operand fallback, quotas, faults, reentrancy and stale or
disposed handles. Serial Node 24 validation at `d935c73a` passed 56 of 57 tests
across the bridge, encoder, eligibility, frame lifecycle and snapshots. The new
heap-fault fixture initially limited PE input size before execution; `3ac47202`
lowers the heap after loading and asserts each expected managed fault explicitly.
All 13 bridge tests then passed. No browser/native matrix or performance
improvement is claimed.

Automatic hot counters, background compile queues, entry selection, OSR and
debugger-driven deoptimization remain separate T11 deliverables. Source VM and
Rust integration are unsupported. The runnable example is
`node examples/runtime/wasm-runtime-bridge.mjs` after workspace installation.
