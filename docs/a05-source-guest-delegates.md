# Source guest callbacks and exception events

Registered framework delegates now retain one managed representation through local variables, fields, parameters,
returns, method groups, capturing lambdas, invocation, equality and multicast combination/removal. The semantic compiler
uses the existing `Op.DELEGATE`/CIL `ldftn; newobj` path. A callback names the original guest method and receiver;
re-evaluating an instance method group therefore produces an equal delegate and removes the matching subscription.
User-defined delegate types keep their existing generated source dispatch classes.

`Task.Run` and registered event accessors accept those values directly. AppDomain first-chance and unhandled callbacks
run as ordinary managed frames through the existing exception notification state machine. Their subscriptions,
arguments, pending fault and callback continuations remain part of local and portable snapshots. No host function is
serialized or invoked on behalf of the guest.

The A05 framework reservation appends three `System.Delegate` contracts after the existing entries: two-operand
`Combine`, `Remove`, and `op_Equality`. Existing contract IDs retain their values. These adapters use the same invocation
list and canonical method/receiver equality implementation as CIL delegates. Managed root visitors already retain
native invocation lists and the target closures.

Regression coverage is in `tests/a05-source-appdomain-events.test.js` (source, reloaded source and CIL), including
multicast subsequence removal, delegate variables, capturing lambdas, and an unhandled callback restored after the
old heap is collected. `tests/a05-source-monitor-queues.test.js` schedules both a stored Action and a direct lambda.
These new cases require the integration runner qualification; this document records implementation, not a passing run.

Guest event delivery follows the pinned CoreCLR 8/10 policy, including
[`ExceptionNotificationFilter` and delivery in v10.0.5](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/vm/excep.cpp).
First-chance callbacks can receive nested notifications. If a fault escapes a first-chance callback, the first-pass
notification filter fails fast with `ExecutionEngineException` before finally cleanup, outer catches or unhandled
events run. The VM retains the throwing frames for inspection and reports the managed `0x80131506` process code.
`UnhandledException` callback failures are isolated instead: callback cleanup runs, later subscribers retain their
captured order and the original terminating exception remains unchanged. Its null sender is supported by both the
[v8.0.0 native AppDomain delivery](https://github.com/dotnet/runtime/blob/v8.0.0/src/coreclr/vm/appdomain.cpp) and the
[v10.0.5 managed AppContext delivery](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/AppContext.cs).

`tests/a05-exception-event-policy.test.js` uses the retained first-chance and unhandled native fixture sources on
source, reloaded source and CIL, including local and portable replay before and after a failed callback. Native
qualification must record the actual SDK/runtime version. The development source.dot.net first-chance isolation
policy differs from these pinned versions; it is not this runtime's compatibility target.

Native commands, run serially through the repository's resource wrapper:

```sh
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/first-chance-policy --failfast --output artifacts/a05-events
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/unhandled-policy --fault Exception --output artifacts/a05-events
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/exception-event-identity --output artifacts/a05-events
```

The `--fault` mode requires an exact ordered stdout trace, the expected System exception in native stderr,
and a faulted VM with that same exception type. The report retains the native exit code or SIGABRT and the VM's
managed process code separately. A successful native exit, timeout, unrelated signal or wrong exception cannot pass.
This mode does not compare operating-system signal numbers with the managed process code.
The separate `--failfast` mode requires the native execution-engine HRESULT `0x80131506` and a fatal VM result
with that managed process code. The temporary build project pins the exact probed SDK with roll-forward disabled,
so a .NET 8 qualification process cannot silently build its fixture with a different installed SDK.
The identity fixture separately checks native method-group equality, multicast subsequence removal, captured callback
variables, duplicate subscription removal and null handlers. It does not rely on an exception escaping a subscriber.
