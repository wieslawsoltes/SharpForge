# CIL exception-origin events

The existing `runtimeEvents: true` option records `ExceptionThrown` at the CIL
slice's first managed fault boundary, before `onException` and managed handler
search. An opcode fault, an explicit `throw`, an invalid `rethrow`, or an
instruction-admission resource fault emits one event. The existing first-chance
debugger callback and exception behavior are unchanged.

An event describes an **originating throw**, not every propagation step. Valid
`rethrow` of the exact active caught fault emits no additional event. Recursive
unwind, finally continuation, debugger pending-fault resume, and restoration of
a pending fault likewise do not create origins. A subsequent explicit `throw`
of the same guest exception object is a new origin. Cached initializer failures
raised by a later guest instruction also cross a new first-fault boundary;
wrapping during propagation is not a separate event.

The payload is `{name, exceptionType, method, frame, ilOffset, fatal}`. `name`
preserves the raw runtime diagnostic name; `exceptionType` applies the shared
managed exception aliases. Names are bounded to 4,096 characters. Method token,
frame identity, and IL offset identify the attempted instruction; unavailable
location components are `null`. `fatal` identifies existing resource faults that
bypass user catches. No messages, handles, fault objects, or frames are retained
in an event. Timestamp and chronological sequence follow the existing
instruction-based event log.

Events are queued before the debugger notification, but subscribers run only at
the existing host flush boundary after dispatch. Subscriber failures stay host
errors and cannot be caught by guest handlers. The log retains its bounded
capacity, drop-oldest, subscription-disposal, and stop behavior.

No exception-observation fields or deduplication caches are added. Valid rethrow
is recognized using the existing instruction and caught-fault identity, so a
snapshot's copied canonical fault continues to suppress propagation events.
Host event history does not rewind. Replaying an originating throw instruction
produces a new event; replaying an already-pending fault or catch rethrow does not.

Direct `vm.step()` and host `vm.raise()` retain their existing low-level boundary:
they do not automatically emit this slice event. Source-VM exception events,
native EventPipe transport, and browser/performance qualification remain outside
this partial #1403 delivery.

To observe the stream, subscribe to `vm.runtimeEvents` after constructing
`CilVirtualMachine(bytes, {runtimeEvents: true})` and filter
`event.name === RuntimeEventName.ExceptionThrown`. Run through `runSlice`,
`run`, or `runAsync` for deferred delivery. Focused direct-CIL fixtures are in
`tests/a05-exception-events.test.js`; their execution awaits the serial queue.
