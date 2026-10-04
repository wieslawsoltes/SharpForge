# Analysis and native background tasks

`BackgroundTaskBridge` adds the two production operation sources previously absent
from the workbench TaskCenter. Existing `subscribeShellServices` build entries and
Find in Files search entries remain their respective owners. The bridge neither
selects a project nor reveals a tool, so background work cannot change active UI
selection.

## Studio composition

Create one bridge after the shell TaskCenter and BuildServices exist:

```js
import { BackgroundTaskBridge } from './workbench/background-tasks.js';

const backgroundTasks = new BackgroundTaskBridge({
  tasks: workbenchShell.tasks,
  builds: workbenchServices.builds,
  onError: error => toast(error.message, 'error')
});
```

The adapter subscribes to real BuildServices events. No extra callbacks are needed
around `StudioExecution.analyze`, and installing it after an analysis starts
adopts that request's current epoch. Dispose it before the shell TaskCenter.

Forward the existing `NativeConfiguration.onJob` notification while preserving
its current UI/diagnostic work. Capture the client immediately; looking up a
current selected job when the user later presses Cancel would target the wrong
operation:

```js
const client = nativeBuild.client;
backgroundTasks.nativeJob(job, {
  owner: client,
  cancel: () => client.cancel(job.id)
});
```

The callback may return the native cancellation response; the bridge consumes
that exact job's acknowledgement. Normal later `onJob` polls still supply the
terminal state. Distinct client objects with the same remote job ID remain
independent. The bridge retains no request arguments, properties, environment or
capability tokens. It keeps only the display action/project, progress and the
captured cancellation closure while that operation is live.

If the native controller reports an active-job transport failure, forward the
captured job ID and client through `nativeFailure(id, error, {owner: client})`.
This closes only a matching observed job. Connection errors before any job exists
have no task to close and can retain the existing normal error notification.

`nativeJob` returns the TaskCenter ID, or `null` for a known terminal replay,
disposed bridge or rejected input. `nativeFailure` returns whether it settled an
active match. `settled` waits for currently submitted native cancellation
callbacks; it is useful for teardown tests, without polling a provider.

## Analysis lifecycle

BuildService delegates request ownership to `BuildAnalysis`, which emits
`analysis-started`, `analysis-completed`, `analysis-failed` and
`analysis-cancelled`. Each carries `projectId`, `epoch`, captured `revision` and
`background: true`. Successful analysis also retains the existing `analysis`
event with its result. Build artifacts and the successful executable cache remain
separate from analysis results.

`analysisOperation` exposes a frozen `{epoch, revision}` snapshot, or `null`.
`cancelAnalysis(reason, {epoch})` cancels only that matching request. An omitted
epoch targets the current request. Cancellation, project removal, source
invalidation, supersession, malformed results, errors and disposal all produce
one terminal task outcome. A superseded request returns `null`; explicit
cancellation rejects with `AbortError`. A pre-aborted signal refuses before
starting a task.

Targeted cancellation uses the existing WorkerClient AbortSignal contract: the
waiting request is rejected and its late reply is discarded. It does not claim
to interrupt a synchronous compiler computation already executing in that shared
worker. In particular, it does not restart or cancel another build request. The
existing explicit whole-project `cancel()` still restarts that project's worker.

## Task status and bounds

TaskCenter operations gain `reportStatus(message)` for indeterminate phases.
Queued/running/cancelling native snapshots therefore display their actual phase
without inventing a completion fraction. Numeric progress is accepted only when
the provider supplies a finite fraction in `[0,1]`.

`complete({honorCancellation: false})` records an observed native success when
that success won the race with a cancellation request. Existing callers retain
the default cancellation-aware completion. Cancelling notifications are emitted
before callbacks can synchronously settle the task.

The existing TaskCenter concurrency/history limit applies. An analysis that
cannot be tracked because the limit is reached is refused without affecting
other requests. Native identity history is bounded to 200 finished jobs by
default; active owners are released at termination. Duplicate and older native
cursors/phases cannot regress a live record; retained terminal identities cannot
be resurrected. Errors are exposed through `onError` and `lastError`.

## Verification boundary

The complete source scope has focused tests in
`tests/a19-background-analysis-tasks.test.js` and
`tests/a19-native-background-tasks.test.js`. They drive real BuildService request
and event ownership, the existing build-task registration, TaskCenter, and actual
MSBuildTools `accept`/`onJob` callbacks. Worker replies and native client requests
are explicit controlled boundaries; there is no native MSBuild execution or
browser interaction claim. Final Studio callback composition remains root-owned.

After the complete scope was written, this serial limited batch passed all 32
cases (16 new adapter cases and 16 retained build/output and shell/task cases),
with zero failures or skips in 616.582531 ms:

```sh
node scripts/limited.js node --test tests/a19-background-analysis-tasks.test.js tests/a19-native-background-tasks.test.js tests/a19-build-output.test.js tests/a19-shell-commands.test.js
```

These are Node service and controller results. Actual Studio UI composition,
native MSBuild execution, browser cancellation and platform behavior remain
separate qualification work.
