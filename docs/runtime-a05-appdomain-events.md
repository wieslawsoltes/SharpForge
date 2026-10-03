# AppDomain exception notifications

One managed `AppDomain.CurrentDomain` belongs to each VM. The A05 framework reservation adds its
`FirstChanceException` and `UnhandledException` contracts, typed delegate signatures, event-argument
constructors and read-only properties. Existing contract IDs do not move.

Notifications execute synchronously with respect to their throwing logical context, through ordinary
managed callback frames. The interpreter may preempt those frames between instructions. First-chance
callbacks run before the handler search; a debugger pause follows them. Rethrow causes a new notification,
while resuming an event or debugger pause does not deliver it twice. A notification cannot mark an
exception handled. These semantics follow the [FirstChanceException contract](https://learn.microsoft.com/en-us/dotnet/api/system.appdomain.firstchanceexception).

Unhandled callbacks receive the original managed exception and `IsTerminating=true` before the VM enters
its terminal fault state. Their sender is null; first-chance callbacks receive the current domain.
A callback failure cannot replace that original terminating fault. Task-owned
faults are captured by their Task; async-void faults enter a terminating notification context. Exhausted
instruction/output/stack budgets skip guest callbacks and bypass guest catches. The VM reports the managed
exception HRESULT exit code; a native process may expose a different platform exit status or signal.
Failure to allocate or enter a notification ends execution without recursively attempting another event.

Subscriptions are stored in the managed domain singleton. Removing a delegate removes its last matching
invocation subsequence. Each event captures its subscriber list before invoking handlers, so subscriptions
changed by one callback affect later events. Callback continuations are plain snapshot data; active and
parked roots retain the original fault, arguments and remaining delegates. Portable restore validates the
saved subscriber and continuation identities before mutation. Stop releases the domain singleton.

Both source lowering paths use `SharpForge.Runtime.Async.StartVoid(Action)` for `async void`, appended
to the A05 contract reservation. Its hidden task retains the suspended context while escaped faults are
posted to the process. Ordinary async Task methods still use `Start` and keep faults on their task.
Semantic framework event assignments emit native delegates for static and instance method groups,
including explicit delegate construction and null subscriptions. Delegate variables, lambdas and local
functions as semantic framework event handlers still report an explicit profile diagnostic; their lowered
delegate-class representation is not silently passed to the native event registry.

`tests/a05-appdomain-events.test.js` and `tests/fixtures/a05/appdomain-events/Program.cs` provide focused
source/reloaded/CIL regression and reference-program inputs. The expected output is an assertion target,
not recorded native evidence. `tests/a05-appdomain-source-regressions.test.js` adds the semantic method-group,
async-void versus async-Task, and portable unhandled-observer regressions. Qualification is serialized by
the integration owner; this follow-up was prepared by static review and has not run its tests.
