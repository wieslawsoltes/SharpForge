# Source VM exception-origin events

With `runtimeEvents: true`, source and reloaded-source slices record the existing
`ExceptionThrown` event when a dispatched instruction first produces a managed
fault. Recording precedes the existing debugger notification and managed handler
search. Pre-dispatch stack-admission failures are also recorded once, before any
instruction count or program counter advances. No exception-observation state is
added to faults, frames or snapshots.

The event means an originating throw, matching the CIL observer's policy.
Explicit `throw` and instruction faults produce origins. A valid `rethrow` of the
exact active caught fault does not; both its identity and catch range must match.
An invalid rethrow produces a new managed fault and event. Explicitly throwing
the same guest exception object again is a new origin. Finally/unwind continuation,
debugger pending-fault resume, and scheduler delivery of an existing fault do not
create additional origins.

The scalar payload is `{name, exceptionType, method, frame, instructionIndex, fatal}`.
`name` is the raw diagnostic name; `exceptionType` uses the existing managed aliases.
Both strings are limited to 4096 characters. Method and frame IDs identify the
attempted source instruction, captured before execution can unwind or retire the
frame. `instructionIndex` is an index into three-word source instructions, not an
IL byte offset; it has the same meaning for reloaded-source execution. `fatal`
describes the existing noncatchable routing, without changing which faults are
catchable. No exception message, fault object, managed handle or frame is retained.

Same-VM restore preserves chronological host history. Restoring a catch or an
already pending debugger fault does not emit another origin, because the existing
canonical fault identity survives the snapshot copy. Replaying the originating
instruction does emit a new event. Subscribers remain deferred to the source host
flush, outside guest exception handling; callback failures reach the host directly.

Source has no separate public single-opcode `step()` method: an instruction-budget
one `runSlice` uses this origin boundary. Direct host `vm.handleFault()` calls and
direct opcode-handler invocation are lower-level APIs and do not automatically
emit it. This leaf does not add first-chance AppDomain events or a new callback
mechanism. Source scheduler-event delivery and broader platform/performance
qualification remain separate #1403 work.

`tests/a05-source-exception-events.test.js` authors source/reload cases for catch,
finally, valid/invalid/explicit rethrow, pending and caught snapshots, original
instruction replay, instruction/stack quotas, retired-frame location, host callback
failure and low-level delivery. All 76 focused source-exception, source-method,
source-load, CIL-exception and ABI checks passed at `d1a51c97b`, with Node
24.21.0, one worker and a 512 MB old-space limit. Broad qualification remains
deferred.
