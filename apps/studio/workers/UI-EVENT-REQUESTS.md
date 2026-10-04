# Acknowledged UI event decisions

Ordinary notifications continue to use `uiEvent`. A browser control that must wait for a managed cancellation decision calls
`host.requestEvent(id, event, payload, {signal})`, or the equivalent renderer-context method. The host invokes
`onEventRequest`; Studio sends `uiEventRequest` through the existing worker RPC envelope and returns its Promise to the control.
The control applies the returned decision before completing its pending native action. It does not also emit the same event.

## Versioned packets

The RPC request is `{id: rpcId, method: 'uiEventRequest', params}`. Its parameters are:

```js
{
  version: 1,
  sessionId: 7,
  requestId: 12,
  id: '41:1',
  event: 'BeforeTextChanging',
  payload: {NewText: 'proposed text', Cancel: false}
}
```

The outer `rpcId` belongs to the existing debugger RPC transport. The inner `requestId` is a monotonic, positive safe integer
owned by the Studio bridge; it remains monotonic across scene and host replacement. The receiver rejects reused request IDs in
the same application session. Successful replies contain bounded plain data, for example
`{NewText: 'proposed text', Cancel: true}`. Failures use the existing `{name, message, code}` error envelope.

`uiEventCancel` has parameters `{version: 1, sessionId, requestId}`. The receiver ignores cancellation for a different session
or an already completed request. Cancellation identifiers cannot address another application session.

Both sides accept at most 64 pending decisions and use a deadline of at most 30 seconds. Payloads use the existing routed-event
limits: depth 12, 32,768 visited values, 65,536 UTF-16 code units, and 1,024 elements per array. Request validation also rejects
host objects, functions, getters, setters, cycles, non-finite numbers, prototype members and unexpected envelope fields.
`GetDeferral`, native event objects, DOM nodes, functions, managed references and passwords never travel in decision packets.
The worker resolves the target ID against its active managed scene and checks the event against that type's registered contract.

## Managed callback and deferral lifetime

`ManagedUIContext.requestEvent(receiver, event, payload, options)` is the receiving seam. It dispatches through the existing
root-scoped routed-event router, preserving ordinary subscription order, `AddHandler` order and `handledEventsToo`. Preview
events tunnel; existing routed events bubble; family decisions such as `BeforeTextChanging` and `RefreshRequested` dispatch
directly to their owner. `raiseAsync` leaves synchronous `raise` behavior unchanged.

Each callback runs as normal cooperative UI work. This matters for async-void handlers: the compiler's kickoff creates an
`Async.Start` child, whose initial phase must reach its first pending await before the kickoff returns. The initial phase can
therefore acquire the existing `Windows.Foundation.Deferral`. The decision seals the existing `DeferralGroup` after all handler
initial phases run, then awaits explicit deferral completion. Async-void body faults reject a still-pending decision. A handler
that needs its work after an await to affect the decision must acquire a deferral before awaiting.

Scheduler completion observers run only at context completion, cancellation and rewind boundaries. They add no instruction
polling. Async children inherit an explicit UI dispatcher identity from their UI parent; that identity survives scheduling and
snapshots. Independent task and thread contexts do not inherit UI access.

The pending decision roots its managed owner, route owners and argument wrappers through the existing application model-state
root provider. Completion, abort, pause, scene replacement, session replacement, timeout, rewind and disposal end the external
decision and release its native roots and listeners. Rewind cancels external decisions instead of replaying browser actions.
Existing managed continuation and heap ownership still govern a handler that remains alive after its decision is canceled.
Late replies never change a settled decision or start a native action in a replacement host.

Only mutable decision fields are copied back from managed arguments: `Cancel`, `Handled`, `CanExecute`, `IsBlackout`, `State`,
`AcceptedOperation`, `AllowedOperations` and `Content`, when declared writable by the argument contract. Proposed text, identity, position
and reason remain input data. Password decisions carry `Length` and `Cancel`; secret values use the existing private input channel.

## Contract compatibility

Released event delegate signatures remain unchanged. Some existing events still infer `RoutedEventArgs` statically even though
the family runtime constructs the declared, more specific argument type. Such source handlers use an explicit cast to that
declared family type before accessing `Cancel` or `GetDeferral`. This bridge does not establish native WinUI event-signature
parity and does not redefine those released delegates or introduce companion events.

## Qualification

The implementation reuses the host request lifecycle, routed-event serialization, managed event arguments, `DeferralGroup`,
cooperative scheduler, and existing asynchronous RPC reply envelope. No dynamic evaluator or second managed continuation engine
is introduced.

Focused fixtures are authored in `tests/a16-context-completions.test.js`, `tests/a16-routed-event-requests.test.js`,
`tests/a16-ui-event-transactions.test.js`, `tests/a16-studio-event-requests.test.js`, and
`tests/a16-managed-event-requests.test.js`. They cover ordered routing, exact mutable outcomes, real source/reloaded/direct-CIL
async deferrals, UI dispatcher inheritance, pending argument GC, abort/rewind/disposal, replay rejection, limits, injected timer
failure, pause, scene/session replacement and late replies. The family and host request fixtures cover the browser-side decision
application. They passed in the complete integrated A15/A16/A17 gate at `a41a1767`, after the earlier A16 gate
identified typed-boolean outcome and idle-callback lifetime faults. That complete gate ran 1,338 tests, with
1,320 passing and 18 failures in other recorded scopes; its result does not replace required core on each exact
publication tree. The nested CIL callback-frame and precise-GC regression also belongs to this completed software gate.
Native browser and WinUI reference qualification remains separate and must be reported only when actually executed.
