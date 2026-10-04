# Direct CIL Task state-machine ABI

The direct CIL interpreter has a bounded Task ABI contribution. This is separate from
the source VM's `SharpForge.Runtime.Async` lowering and from native .NET execution.
The contribution is implemented but has **not yet passed post-change qualification**.
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
box. Callback contexts do not own the final Task through context return: only the
builder's SetResult or SetException completes it. Pending continuations own managed
call data, are rooted and snapshotted, and are removed before delivery. VM stop drops
pending callbacks; normal task cancellation still delivers await continuations.

GetAwaiter().GetResult() delivers the original managed exception. Wait and Result use
an explicit aggregate-failure mode in the scheduler wait record. Completed tasks retain
their original exception reference in managed heap storage. Delay(int) distinguishes
the infinite -1 timeout, zero, and the nonnegative Int32 range. No JavaScript Promise,
host delegate or synchronous run-until callback executes a state machine.

Queued qualification:

```sh
node scripts/limited.js node --test tests/a05-cil-async-profile.test.js tests/a05-cil-async-native.test.js
node scripts/limited.js node --test tests/compiler-lowering-async.test.js tests/compiler-lowering-async-streams.test.js \
  tests/a05-seams-cil-intrinsics.test.js tests/a05-managed-address.test.js tests/a05-value-storage.test.js
```

The native driver compares real Roslyn Debug and Release images, and independently
emitted SharpForge images, with actual .NET output. It covers ordinary and suspended
completion, Yield, exception identity, Wait/Result aggregation, Delay boundaries,
reference-field replacement, GC, snapshot/restore and collection during allocation.
Malformed ABI identities, signatures and callback bodies are verifier controls.
The focused adjacent tests cover the shared source scheduler and ordinary storage.

ValueTask, custom notification awaiters, async void and async iterators remain separate
runtime extensions. Browser and Rust/Wasm execution have not been qualified for this
contribution. No performance pass is claimed; the verifier, scheduler and GC changes
require paired ordinary-control and async measurements in the serial validation slot.
