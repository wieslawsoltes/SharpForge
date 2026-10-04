# Source VM method lifecycle events

With `runtimeEvents: true`, source and reloaded-source VMs emit the existing
`MethodEnter` and `MethodLeave` event names in addition to their
[heap events](runtime-source-heap-events.md). This leaf introduces no new event
name or callback API. Each payload contains `{method, frame, reason}`: `method`
is the source image's numeric method ID, `frame` is the VM's fresh invocation ID,
and `reason` is a string. Source IDs are not CIL metadata tokens. The payload never
contains frame objects, local variables or managed handles.

An entry with reason `call` follows successful frame admission, including argument
setup and stack-budget reservation. Rejected admission emits no entry. Returning
from a frame emits one leave with reason `return`, after all its finally handlers
have run. Exceptional unwind emits reason `exception` only when the frame exits;
a local catch, rethrow, or transfer into finally does not itself close the span.
Pooled frame reuse receives a fresh ID, and the host observer retains only IDs.

Live parked contexts remain open. At the existing host flush boundary, discarded
parked stacks close with reason `canceled`, innermost first. Frames deliberately
retained for fatal-fault inspection stay open until they are actually discarded,
restored or stopped. `stop()` completes scheduler/platform/frame cleanup before
closing remaining spans with reason `stop` and invoking subscribers. Repeated
stop or cancellation does not duplicate leaves.

A successful same-VM restore closes currently observed spans with reason
`restore`, then enters the restored active and parked frames with that reason.
This happens after restore succeeds, with no subscriber callback during restore.
Rejected restore leaves observations unchanged. Log history and subscriber cursors
do not rewind; matching spans across restore uses event order as well as frame ID.
Restored entries do not increment profiler call counters. No observer state is
stored on frames or in the guest snapshot.

The active index is bounded by live invocations and frames awaiting the next host
reconciliation. The shared event log independently enforces its configured ring
capacity. Dropping an old entry does not keep a completed invocation active.
Subscribers remain outside managed exception dispatch, so their failures reach
the host. No work is enabled by reading `vm.runtimeEvents` when the option is off.

`tests/a05-source-method-events.test.js` authors source/reload coverage for pooled
calls, rejected admission, finally/catch/rethrow, pauses, fatal inspection,
snapshot rejection/restart, parked cancellation/wake, disposal and overflow.
The existing heap tests now filter their event family while preserving payload
and ordering assertions. Tests have not been run here; serial validation is
pending. [Source method-load events](runtime-source-method-load-events.md) now
precede each metadata method's first observed admission.
[Source exception origins](runtime-source-exception-events.md) share the same log.
Source scheduler events and broader platform/performance qualification remain
separate #1403 work.
