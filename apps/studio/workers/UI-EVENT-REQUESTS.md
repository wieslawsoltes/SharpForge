# Acknowledged UI decision packets

These bounded data and transaction helpers prepare the acknowledged-event channel. Browser, worker and managed host activation are separate dependent stages. Ordinary event notifications retain their existing path.

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


## Transaction ownership

`UIEventTransactions` owns only native pending decisions. It releases timers and abort listeners before settling a Promise, rejects duplicate identities and handles an injected timer failure without leaking an entry. Aborted, timed-out and disposed entries reject once; late resolution returns false.

## Qualification

The packet and transaction cases in `tests/a16-ui-event-transactions.test.js` are authored but unrun in this exact branch. They cover strict envelopes, payload budgets, accessors, classes, executable values, duplicate identities, the 64-request bound, timeout, abort, disposal and timer failure. The consolidated completed-scope gate owns execution.
