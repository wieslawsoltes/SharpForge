# Direct CIL Task state-machine ABI

The direct CIL interpreter has a bounded Task ABI contribution. This is separate from
the source VM's `SharpForge.Runtime.Async` lowering and from native .NET execution.
At executable commit `974a5621bc59088b20b63034306e35b3af2a2122`, the JavaScript direct
CIL interpreter passed 16 focused tests, including genuine Roslyn/CoreCLR comparisons,
and 67 adjacent source-scheduler, intrinsic, delegate and storage tests, with zero skips.
The separate dispatch regression batch passed 33 of 34 tests. Its remaining assertion
expects an older generic-storage diagnostic string; that expectation and the current
rejection text are both present in the frozen baseline source. A baseline-only replay
has not confirmed the mismatch, so it remains unresolved and is not counted as passing.
Commands, timings, source identity and all failed/successful raw logs are recorded in
`tests/fixtures/cil-async/qualification/post-fix.json`.
The frozen baseline is recorded in `tests/fixtures/cil-async/qualification/pre-fix.json`:
six focused failures, zero skips, and eight genuine Roslyn Debug/Release programs that
ran on .NET while their CIL VM admission was rejected.

The supported member definitions cover Task and Task<T> builders, TaskAwaiter and
TaskAwaiter<T>, and the real YieldAwaitable/YieldAwaiter ABI. Calls require exact
substituted signatures and runtime assembly reference identities. Builder Start and
await registration contribute their actual IAsyncStateMachine implementations to the
ordinary verifier worklist. These callbacks keep the existing stack and method budgets.
Explicit MethodImpl declarations and implementations must have compatible signatures.
The public CIL helpers `asyncTypes`, `asyncValueType`, `asyncMethodDefinition`,
`asyncStateMachine` and `asyncCallbackTargets` expose this proof data to the runtime;
they do not execute callbacks or load external assemblies.

Builders and awaiters use immutable value records containing a managed Task reference.
Only intrinsic ABI values and internal types proved to implement IAsyncStateMachine
receive this additional managed-reference value storage. General aggregate admission
is unchanged. Copying or updating such a value rebuilds its immutable reference
inventory; the collector traverses that inventory without scanning metadata per edge.
The existing limits on other generic aggregate arguments and nested value storage
still apply. This contribution does not claim unrestricted Task<T> value-type payloads.

Start enters MoveNext through the ordinary verified managed-call path. A first Release
state-machine suspension creates a stable managed box and executes its SetStateMachine
method before registering the continuation. Subsequent continuations reference that
box. Proved external IAsyncStateMachine MethodImpl declarations use these exact local
callback bodies; malformed signatures, duplicate declarations and local same-name
interfaces retain explicit rejection. Callback contexts do not own the final Task through context return: only the
builder's SetResult or SetException completes it. Pending continuations own managed
call data, are rooted and snapshotted, and are removed before delivery. Task completion
pins their receivers before changing terminal status, including while waiter failures
and callback contexts allocate. VM stop drops
pending callbacks; normal task cancellation still delivers await continuations.

GetAwaiter().GetResult() delivers the original managed exception. Wait and Result use
an explicit aggregate-failure mode in the scheduler wait record. Completed tasks retain
their original exception reference in managed heap storage. Delay(int) distinguishes
the infinite -1 timeout, zero, and the nonnegative Int32 range. No JavaScript Promise,
host delegate or synchronous run-until callback executes a state machine.

Focused qualification commands:

```sh
node scripts/limited.js node --test tests/a05-cil-async-profile.test.js tests/a05-cil-async-native.test.js \
  tests/a05-cil-async-continuation-roots.test.js
node scripts/limited.js node --test tests/compiler-lowering-async.test.js tests/compiler-lowering-async-streams.test.js \
  tests/a05-seams-cil-intrinsics.test.js tests/a05-managed-address.test.js tests/a05-value-storage.test.js \
  tests/a05-delegate-targets.test.js
```

The native driver compares real Roslyn Debug and Release images, and independently
emitted SharpForge images, with actual .NET output. It covers ordinary and suspended
completion, Yield, exception identity, Wait/Result aggregation, Delay boundaries,
reference-field replacement, GC, snapshot/restore and collection during allocation.
Malformed ABI identities, signatures and callback bodies are verifier controls.
The focused adjacent tests cover the shared source scheduler and ordinary storage.

ValueTask, custom notification awaiters, async void and async iterators remain separate
runtime extensions. Browser and Rust/Wasm execution have not been qualified for this
contribution; further generic state-machine boundary qualification also remains queued.
No performance pass is claimed; the verifier, scheduler and GC changes
require paired ordinary-control and async measurements in the serial validation slot.

The prepared benchmark uses 80 warmups and 24 samples, reporting median/p95 admission,
execution and total time plus managed allocations. It includes an ordinary arithmetic
and intrinsic-call control. A directory produced by the genuine reference capture adds
the same Debug/Release async images on both revisions; unsupported baseline images are
reported as rejected rather than timed as successful executions.

```sh
node scripts/limited.js node packages/runtime/bench/cil-async.mjs <reference-capture-directory>
```
