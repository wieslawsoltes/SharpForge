# Cooperative synchronization — A05 T30

`SyncPrimitives` owns Monitor sync blocks by managed object identity and logical scheduler context. Interlocked and Volatile execute within one VM instruction. This gives shared-heap cooperative atomicity in source and direct CIL; it does not create host OS threads, SharedArrayBuffer access, or a cross-worker memory model.

| API | Closed runtime support |
| --- | --- |
| Monitor | Enter, Exit, TryEnter, IsEntered, Wait, Pulse, PulseAll and LockContentionCount; Int32 millisecond timeouts; Enter/TryEnter ref Boolean overloads |
| Interlocked | Int32/UInt32/Int64/UInt64 Increment, Decrement, Add, And, Or; Int64/UInt64 Read; scalar/reference Exchange and CompareExchange; generic reference/primitive/enum Exchange and CompareExchange; MemoryBarrier |
| Volatile | Boolean, 8/16/32/64-bit integer, native integer, Single, Double Read/Write; generic reference Read/Write; ReadBarrier/WriteBarrier |
| Thread | MemoryBarrier |
| C# lock | Frontend lowering to Monitor Enter with ref lockTaken and finally Exit; integration module supplied separately |

Monitor ownership is reentrant per logical context. Wait releases the complete recursion count, joins the condition queue, and restores that count before returning. A timeout moves a waiter to the acquisition queue; the call does not return until it reacquires the monitor. Pulse moves one current condition waiter and PulseAll moves all; pulses are not saved for future waiters. The cooperative scheduler uses FIFO acquisition queues for reproducibility; .NET does not promise this ordering. Unowned Exit/Wait/Pulse throw SynchronizationLockException. A non-null managed object is required, including valid VM-owned generation/heap identity.

Interlocked operations read and write through validated managed addresses. No other context can execute between those steps. Arithmetic wraps at the declared width; And/Or/Exchange/CompareExchange return the old value, while Add/Increment/Decrement return the updated value. Floating CompareExchange compares raw bits, so +0 and -0 differ. Reference CAS uses reference identity. The .NET 10 generic API accepts primitive and enum value types as well as references; aggregate structs such as Decimal are rejected. Generic Volatile accepts reference types only. Volatile and barrier calls advance a visible fence revision; ordinary shared state is already sequentially executed by this single-agent scheduler.

TimeSpan timeout overloads, OS synchronization domains, Thread.Interrupt/Abort, process-wide barriers, unmanaged pointers, and the separate .NET 9 Lock class are outside this descriptor profile. Monitor.Wait on a native browser CLR may itself be unsupported without managed threading; the JavaScript cooperative runtime is a different execution target and must be qualified separately.

## Scheduler and snapshot hooks

Both VM constructors create `vm.sync = new SyncPrimitives(vm)` after the scheduler and before entry-point execution. Runtime dispatch calls `invokeSynchronization` or `vm.sync.invoke`, which returns `{handled,value}`. A blocked call returns the existing SUSPENDED sentinel and completes through a scheduler task only after acquisition. The CIL package exports `syncIntrinsicDefinitions` and `isSynchronizationIntrinsic`; the verifier uses the latter for closed MethodSpec signatures as well as ordinary methods. Descriptors use the `synchronization` implementation key.

The scheduler calls `sync.poll()` to move expired waits, combines `sync.nextDelay()` with task deadlines, yields `sync.roots()`, and calls `sync.cancelContext(id)` when a context finishes. Cancellation removes that context's queued waits. If a context ends while still owning a monitor, its ownership is reported as abandoned rather than silently assigned to another context. `cancelAll`/VM stop calls `sync.clear()` after canceling task/context state. `snapshot(memo)` and `restore(snapshot,memo)` preserve queues, flags, fence revision and contention counts through the existing graph-copy memo. The snapshot schema must register sync as a component and validate it before mutation.

`deadlocks()` returns `{cycles,abandoned,waiting}`. Cycles include both indefinite monitor-acquisition edges and scheduler task-wait edges; finite deadlines do not create permanent dependency edges. Condition waits are listed without guessing which context will pulse. The scheduler or debugger decides whether a stopped graph is a deadlock after considering runnable/frozen contexts and external operations. These are diagnostics, not an invented CLR DeadlockException. No timeout is silently injected into an indefinite managed call.

## Deferred qualification

This component starts from assembled E01 commit `69bba4c`. No validation is run until all E01 runtime and frontend work is assembled. Then run:

```sh
node --test tests/a05-30-*.test.js
A05_SYNC_OUTPUT=/tmp/a05-sync-native node scripts/validate-a05-sync-dotnet.js
```

The native runner requires .NET 10 (`DOTNET_PATH` can select it), builds the checked-in Program.cs, runs real native threads, and runs the exact resulting DLL in the CIL VM. Source and emitted CIL are compared with the same native output at scheduler quanta 1, 7 and 256. It records the assembled commit, Node/SDK/runtime versions, architecture, source/DLL hashes and outcome matrix, and can retain the DLL/runtimeconfig/source/report artifacts. The isolated unit scheduler is explicitly a test adapter and is never native qualification. Pending Node Linux/macOS/Windows and Chromium/WebKit/Firefox checks must each be recorded by the integration owner; no platform is qualified by this unexecuted component commit.

Reference behavior is pinned to [Monitor.Wait](https://learn.microsoft.com/en-us/dotnet/api/system.threading.monitor.wait?view=net-10.0), [Monitor.Pulse](https://learn.microsoft.com/en-us/dotnet/api/system.threading.monitor.pulse?view=net-10.0), [.NET 10 Interlocked](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Private.CoreLib/src/System/Threading/Interlocked.cs), and [.NET 10 Volatile](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Private.CoreLib/src/System/Threading/Volatile.cs).
