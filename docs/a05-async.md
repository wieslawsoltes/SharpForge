# A05 T29 compiler-generated state machines

The CIL executor runs Roslyn's emitted `MoveNext` methods. Builder hooks preserve
the generated state fields and copy the initial value-type machine into one
managed box when it first suspends. Subsequent continuations address that same
box. A scheduler context waits for the awaited task without raising its fault;
`TaskAwaiter.GetResult` raises the fault inside `MoveNext`, where the generated
catch and finally regions execute. Completion publishes the builder's result or
exception and releases its machine reference.

`AsyncVoidMethodBuilder.SetException` posts an unhandled managed fault for the
next scheduler boundary. It does not synchronously throw into the caller. The
pending fault is included in scheduler snapshots and managed roots. Default
builder copies create distinct tasks when first materialized. Default
`TaskAwaiter` has no task; default `YieldAwaiter` remains valid and always yields.

| Surface | Scope |
| --- | --- |
| CIL builders | `AsyncTaskMethodBuilder`, `AsyncTaskMethodBuilder<T>`, `AsyncVoidMethodBuilder`; `Create`, `Start`, `SetStateMachine`, `SetResult`, `SetException`, `Task`, both await registration methods |
| CIL awaiters | `TaskAwaiter`, `TaskAwaiter<T>`, `YieldAwaitable.YieldAwaiter`; result, completion query, safe and unsafe continuation registration |
| State machines | Value-type and reference-type `IAsyncStateMachine` implementations; verified `MoveNext` IL, including closed generic machines |
| Iterators | Roslyn `IEnumerable`/`IEnumerator` classes use the existing virtual/interface dispatch, fields and EH implementation; `Environment.CurrentManagedThreadId` supplies logical-context identity for enumerator reuse |
| Scheduling | Cooperative logical contexts with deterministic virtual-time qualification; no host Promise or JavaScript closure is retained in a machine |
| Pause, GC and snapshots | Box, builder task, await dependency and parked frame retain managed roots; snapshots preserve their shared identity; replay includes collection before resuming |
| Cancellation | VM cancellation removes continuations and terminates pending tasks; it does not inject disposal/finally into discarded frames |
| Explicitly unsupported | `ValueTask`, custom awaiters/builders, configured awaiters, async iterators, synchronization-context capture, OS-thread identity and parallel CLR execution; broader Task/BCL surface belongs to A11 |
| Source engine | Existing source async lowering keeps its scheduler path; these hooks are for compiler-emitted CIL infrastructure |
| Tiered execution | No tiered qualification until E02 provides that executor |
| Browser | Portable runtime module; browser qualification requires the integrated browser gate and is not inferred from Node results |

The finite descriptors in `packages/cil/src/async-profile.js` define the verifier
and runtime contract together. `asyncMethodDefinition` checks closed signatures
and rejects unsupported concrete awaiters. `reachableAsyncMethods` adds generated
`MoveNext` and `SetStateMachine` methods that have no direct IL call site.
`asyncTypeDefinition` supplies value-type and interface descriptors before the
MethodTable registry materializes fields in user-defined machines.

The runtime export `invokeAsyncIntrinsic(vm,descriptor,args)` returns
`{handled,value,returns}`. The call adapter must check it before the existing Task
framework surface: CLR `Task.Yield()` returns `YieldAwaitable`. `Start` pushes a
verified `MoveNext` call frame and returns `SUSPENDED`; callers must not push that
sentinel as a managed return value. No scheduler wait is installed by `Start`.

Suspension calls
`scheduler.enqueueCall(token,args,{waitTask,propagateFault:false,extra})`;
`extra` contains the concrete `genericIdentity` and `asyncBuilderTask` reference.
Continuation registration uses the corresponding `enqueue(delegate,args,options)`
hook. Async-void failure uses `scheduler.postAsyncFault(error)`. Active and parked
frame roots retain `asyncBuilderTask`; VM roots include `asyncRoots(vm)`. Pending
tasks carry plain `asyncState` records, copied by the scheduler snapshot machinery.
The terminal task heap record retains its exception through `$exception`.

The independent tests cover two awaits, normal and exceptional cleanup, two
snapshot replay points, collection, cancellation, malformed signatures, default
values, double completion and posted async-void faults. Independent iterator IL
covers interface calls, completion, disposal and pause/snapshot between yields.
The native fixtures exercise actual Release Roslyn lowering, including generic
async methods, async void, `Task.Yield`, nested async faults, iterator disposal
and rejected `Reset`.

No T29 validation has been run while E01 is incomplete. Once the full scope is
assembled, the same-DLL qualification command is:

```sh
node scripts/validate-a05-type-system.js \
  --fixture tests/fixtures/a05-async \
  --fixture tests/fixtures/a05-iterators \
  --async --snapshot-await --task SF-A05-E01-T29 \
  --output artifacts/a05-async
```

The runner compiles each fixture once, runs that DLL with native .NET and CIL,
and compares stdout and exit status with `expected.txt`. For fixtures containing
async machines it requires at least two observed suspended awaits, restores each
captured snapshot, collects the heap, and compares replay output with native
execution. Evidence includes sources and DLL hashes, SDK/runtime versions,
commands, instruction counts, snapshot counts and results. Iterator-only fixtures
do not require scheduler suspension.

Semantics were checked against the .NET 10 implementation of
[AsyncTaskMethodBuilder<T>](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Private.CoreLib/src/System/Runtime/CompilerServices/AsyncTaskMethodBuilderT.cs),
[TaskAwaiter](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Private.CoreLib/src/System/Runtime/CompilerServices/TaskAwaiter.cs),
[AsyncVoidMethodBuilder](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Private.CoreLib/src/System/Runtime/CompilerServices/AsyncVoidMethodBuilder.cs), and
[AsyncMethodBuilderCore](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Private.CoreLib/src/System/Runtime/CompilerServices/AsyncMethodBuilderCore.cs).
