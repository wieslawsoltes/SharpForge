# CIL call argument buffers (SF-A05-T09.1, #1399)

Direct CIL local-method calls already use the frame pool's temporary argument
arrays. Synchronous intrinsics and managed delegate construction/invocation now
reuse that same storage. The call boundary borrows a buffer, roots its values
during dispatch, and clears/releases it in `finally`, including a throwing call.
Argument preparation remains O(argument count); warmed sequential calls reuse one
buffer across different argument counts.

Managed delegate binding and `cilCallFrame` copy arguments into owned storage
before dispatch returns. The scratch array therefore never becomes a callee's
argument array or a scheduler continuation. Registered platform contracts keep
their existing owned arrays: asynchronous host adapters may retain them beyond
the invocation. Their ownership contract is outside this increment.

This reuses the argument-buffer portion of the assembled E02 frame pool and
respects `framePooling`, `framePoolBytes`, stop, code-epoch changes and restore.
The reset optimization from c7bece02 is already on main: retirement enumerates
own fields without `Object.keys`, including unknown late-added fields. This
increment leaves that reset and all frame attachment lifecycles unchanged.

`tests/a05-call-argument-buffers.test.js` covers pooled allocation counters,
disabled pooling, arity changes, exceptional release, delegate ownership, and
suspending platform-contract ownership. Serial Node24.21.0 validation passed
48 new/frame-pool/verified-stack cases plus the existing delegate/Decimal integration
regressions at `2043a893`. Broader qualification and performance measurements
remain queued for the completed scope.
The counters measure pool allocations, not every JS allocation or retained heap
byte. No elapsed-time speedup is claimed.
