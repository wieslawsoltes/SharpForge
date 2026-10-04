# Source VM heap events

`new VirtualMachine(image, {runtimeEvents: true})` exposes the same bounded
`RuntimeEventLog` as direct CIL. The option also accepts the existing log options,
such as `{capacity: 128}`. It applies to a source image and to an assembly loaded
back into the source VM. Omitted or `false` leaves `vm.runtimeEvents` as `null`.
Invalid option shapes and invalid log bounds fail explicitly during construction.

This increment observes `GCStart`, `GCEnd` and `AllocationTick` through the shared
heap instrumentation. The [GC](runtime-gc-events.md) and
[allocation](runtime-allocation-events.md) payloads and accounting rules are
unchanged: logical managed bytes and scalar counters, never managed handles.
It observes guest and host heap operations after instrumentation is initialized,
including entry-argument allocation. Initial static-value setup precedes that
initialization and is not reported. Standalone heaps remain uninstrumented.

For example, subscribe with `vm.runtimeEvents.subscribe(event => events.push(event))`
and execute `vm.runSlice()`. Events are recorded at the current source instruction
count, but subscribers run only after dispatch and frame cleanup, outside managed
exception handling. A zero-instruction or paused slice also flushes queued events.
The profiler closes its guest interval before callbacks run. Subscriber failures
propagate to the host without becoming managed faults. `stop()` disposes scheduler,
platform and frame state before flushing, so a callback cannot prevent cleanup.
Explicit `vm.runtimeEvents.flush()` remains available for host-driven heap work.

The log and subscriptions belong to the VM's host lifetime through a private weak
association and a prototype getter. They add no own VM, heap or snapshot fields.
Same-VM restore retains heap-event history and subscriber cursors without adding or
replaying heap events. Guest heap statistics and instruction counts rewind, so they may
repeat; monotonically increasing event sequence numbers identify observations.
The existing drop-oldest count, replay option and subscription cancellation apply.

[Source method lifecycle](runtime-source-method-events.md) uses the same log and
explicitly restarts spans on successful restore. [Exception origins](runtime-source-exception-events.md)
and [cooperative context events](runtime-context-events.md) also use this log.
This leaf does not claim native EventPipe transport or CLR sampling cadence.
The source and reloaded-source tests in `tests/a05-source-heap-events.test.js`
cover guest execution, initialization, weak collection, restore, disposal, host
failures and profiling coexistence. All 75 focused source-heap, allocation, GC,
duration-profiler, and ABI checks passed at `64d24e8b`, using Node 24, one worker,
and a 512 MB old-space limit. Broader platform/performance qualification remains
staged.
