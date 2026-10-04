# Cooperative runtime context events

With `runtimeEvents: true`, `Suspend` records a live active context losing
execution when the cooperative scheduler switches to another context or parks
because nothing is runnable. `Resume` records a previously observed suspended
context becoming active again. A newly queued context's first activation emits
neither event. Direct CIL, source and reloaded-source VMs use the same scheduler
observer. Payloads contain only `{context, frame}`: logical context ID and
the top managed frame ID at that transition. They are not OS thread identifiers.

The events are emitted after the existing load or park operation commits. The
scheduler's selection, wait, quantum, freeze, and task-completion policies are
unchanged. An ordinary `runSlice` time/instruction-budget yield does not park a
context and emits neither event. A quantum that selects the same context emits
neither event. A wait that completes before the scheduler actually switches or
parks also emits neither event. Freezing an active context can cause a real
suspension when the scheduler next processes it.

Observations use weak context identity outside the execution graph; they retain
no guest frames, task handles, or stacks. There are no new VM, context, scheduler,
or snapshot fields. Completion removes a context's observation, and cancellation
or stop clears the observation baseline without inventing a `Resume` for work
that never ran again. Bookkeeping is constant-time per transition and allocates
no event payload when events are disabled. Source support reuses these exact
transition hooks and weak observation state; it adds no scheduling policy.

Restore explicitly starts a fresh observation baseline. Existing log history
remains chronological, but its old suspensions are not paired with the restored
context objects. The first activation of a restored context is silent; subsequent
real suspensions and resumptions produce new pairs. As with cancellation and
buffer overflow, an old `Suspend` may therefore have no matching `Resume`.
These are runtime observations, not rewindable synchronization records.

Subscribers use the existing deferred host flush; scheduling and `advance()` do
not invoke them. Callback failures remain host failures after the context change
is complete. Instruction timestamps, bounded capacity, drop-oldest behavior,
unsubscribe, and stop follow the existing runtime-event contract.

For a deterministic example, construct a CIL VM containing `Thread.Sleep(10)`
with `{runtimeEvents: true, virtualTime: true}`. `vm.run()` parks it and queues
`Suspend`; `vm.scheduler.advance(10)` activates it and queues `Resume`; the next
`runSlice()` delivers the resume notification. Filter the log for
`RuntimeEventName.Suspend` and `RuntimeEventName.Resume`.

Direct-CIL regression cases are in `tests/a05-context-events.test.js`. Initial
validation passed 21 of 22 focused checks; after moving a snapshot-schema
assertion to the actual restore boundary, all eight context-event cases passed
at `8910aabb`. Product behavior was unchanged. Checks used Node 24, one worker,
and a 512 MB old-space limit.

Source and reloaded-source cases are in `tests/a05-source-context-events.test.js`.
The source extension covers actual wait/wake, round-robin switch, freeze,
cancellation, restore, disabled instrumentation and host callback failures.
Source test execution and broader #1403 platform/performance qualification remain
in the serial queue; no performance result is claimed.
