# Project 16 browser runtime timer ownership

## Observed failure

Hosted qualification a5 ran source `c13aa0fd9d27df28b3708bb83d914a04c20a5c7c`, tree
`29023ed8b962b6d91671bdb0c0359d905ef2659e`. The multi-session scenario imported its solution and retained launch
profiles, then timed out waiting for its two running applications. Both the HTTP and actual offline `file:` workflows
created and built the console project, then timed out waiting for the line-5 breakpoint.

The workflow traces retain a failed launch result (`started: []`) and a preceding `Illegal invocation` toast. Their
page-error stacks enter `AppSession.receive` while emitting the initial runtime UI reset. The failed launch's error
notification subsequently throws another `Workbench event listeners failed` aggregate, obscuring the original timer error.
The raw a5 reports remain historical failures; this source correction does not change their recorded outcome.

## Cause and correction

`RuntimeActivity` stored the native worker `setTimeout`/`clearTimeout` methods on its activity object and invoked them as
instance methods. `ExecutionCapture` did the same with the main Window's native timers. Those calls supplied an activity
or capture object as the receiver instead of the browser global that owns the timer.

The runtime worker posts its UI reset before starting activity sampling. `AppSession` records that message's runtime
serial before notifying listeners, so the reset is also the first event eligible to wake the diagnostic capture. Capture
timer scheduling threw before storing its handle. The error notification then retried that same unsuccessful wake.

Both services now use the small shared `workers/host-timers.js` adapter, which calls the timer methods explicitly on
`globalThis`. The existing injected scheduler callbacks retain their previous receiver and contract. Pump budgets,
capture intervals, cancellation, launch identities and stale-callback checks are unchanged. The correction does not
change breakpoint behavior, suppress listener errors, or increase browser deadlines.

## Regression scope and qualification boundary

`tests/a19-runtime-host-timers.test.js` covers default scheduling/cancellation for the worker pump, animation clock and
occupancy sampler; capture wake on the first runtime UI message; duplicate wake, pause/resume and disposal; and the
existing injected scheduler receiver. The receiver-checking timer boundary rejects calls through a foreign object.

`tests/a19-studio-runtime-timers.test.js` connects the actual production runtime worker to the actual `AppSession`,
`SessionManager`, state facade and `ExecutionCapture`. Its Node transport enforces browser timer receiver rules in both
the worker and the host. Source VM and direct CIL cases execute the workflow's console breakpoint/step/continue and
validate actual output and measured capture. Two-application cases execute the existing WinUI fixture with separate
arguments/environment, then check targeted stop, background restart and composite capture identity.

The tests do not replace runtime responses or relax the hosted assertions. They do not execute a browser renderer or
claim native/platform acceptance. These new tests and the corrected hosted workflows are **pending execution** in the
parent's completed correction cohort. No test, build or browser run was performed while preparing this source batch.
