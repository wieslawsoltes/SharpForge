# JavaScript event decisions

`createWinUIApp` installs the same acknowledged host callback as the managed worker application. A renderer calls
`host.requestEvent(id, name, payload, {signal})`; a model adapter can use
`JavaScriptUIContext.requestEvent(owner, name, payload, {signal})`. Both enter the existing host request scope, which bounds
pending decisions, aborts removed targets, and cancels work on root reset or disposal.

The facade resolves the active owner, validates the registered event and input eligibility, then uses the shared
`RoutedEventRouter.raiseAsync`. Ordinary subscriptions and `AddHandler` keep their registration order and share one ephemeral
argument object. Promise-returning JavaScript handlers finish in that order before the decision completes. Synchronous
notifications continue to use `raise`; no acknowledged event is emitted twice.

Deferrable family events expose their existing registered `GetDeferral` member. A synchronous callback can acquire a deferral,
return, and complete that deferral later. The shared `DeferralGroup` is sealed after all callbacks finish and holds the decision
until every acquired deferral completes. Promise rejection, explicit abort, restoration, disposal and the 30-second deadline
reject the decision; a late callback cannot resume the remainder of its canceled route or apply an obsolete host default action.
There are at most 64 pending decisions and 64 acquired deferrals per decision. Host request signals are propagated into the
facade scope.

Only declared writable decision fields are copied back. Proposed text, owner identity, event position and reason remain input
data. Text edits are committed by the host after accepting the decision. Password decisions contain `Length` and `Cancel`;
password characters continue to use the private input path. The returned object uses the existing routed-event data limits and
contains no facade owners, callbacks, native deferral objects or DOM objects.

`FacadeEventRequests` is application model state. Disposal and restoration cancel external actions instead of replaying them.
The argument cache is weak and does not allocate a permanent scene node for each event. A JavaScript callback already waiting
on its own Promise remains governed by ordinary JavaScript lifetime; cancellation prevents accepting its eventual decision.

Focused tests in `tests/a16-javascript-event-requests.test.js` exercise the actual facade projection, family adapters, shared
router and host request scope for text decisions, callback order, explicit refresh/dialog deferrals, rejection, quotas, abort,
node removal, restoration and disposal. These cases passed in the complete integrated A15/A16/A17 gate at `a41a1767`.
Required core on each exact publication tree remains separate; no physical browser or native WinUI result is implied.
