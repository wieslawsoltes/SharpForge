# Native task callback integration

Work item: SF-A19-T35 / #1471. The native controller now carries actual
`MSBuildClient` ownership from operation start through polling, cancellation and
teardown. `nativeConfiguration` forwards it to the shared background task bridge.

Studio passes these callbacks into `createStudioLazyFeatures`:

```js
onNativeJob: (job, ownership) => backgroundTasks.nativeJob(job, ownership),
onNativeJobFailure: (id, error, ownership) => backgroundTasks.nativeFailure(id, error, ownership)
```

`MSBuildTools.accept(job, {owner, select?})` publishes
`onJob(snapshot, {owner, cancel, selected})`. The cancellation closure captures
the actual client and job ID. Callers that omit ownership retain the normal
current-client behavior. Task callbacks, polling and cancellation pass their
captured owner explicitly. NativeConfiguration forwards every valid observed
snapshot to TaskCenter, while a background reply (`selected: false`) does not
replace the selected native job, diagnostics or inspection. Nested notification
guards preserve a newer selection made during a callback.

`onJobFailure(id, error, {owner})` reports only transport/protocol failure for an
already observed job. It is distinct from ordinary `onError` UI reporting. Input,
trust, connection and start failures before a returned job ID cannot settle an
unrelated earlier task. A malformed poll response naming another job fails the
captured requested job without publishing that foreign response.

`workbench/native-operation.js` owns this lifecycle. MSBuildTools delegates
run/accept/cancel/dispose through explicit functions; its frozen legacy module
shrinks and imports packages through public entry points. Polling uses a local
client, job and cursor, independent of later UI selection. Stale cursors and
phases cannot regress a displayed or executing job; a confirmed terminal result
wins over a late running response. Output retention remains bounded to 1 MiB.

## Teardown and cancellation

`dispose()` returns a promise for native cancellation/disconnection. It also
works when existing callers do not await it: pending errors are reported through
`onError` and retained in `disposeError`. Cancellation requests for the same
captured client/job coalesce while in flight. The client's in-memory credential
is cleared after cancellation settles, so a queued TaskCenter cancellation does
not lose its authority before reaching the host.

If disposal occurs during start, the controller waits for the real returned job
ID, cancels that job, then disconnects. It publishes no task or UI state after
disposal. Poll delays and the caller's wait for a pending poll are abandoned on
disposal; a late underlying HTTP reply is ignored. This does not claim that an
already issued fetch was physically aborted. Native process termination and its
result remain owned by the existing host cancellation endpoint.

The background task bridge should still be disposed before the lazy native
controller. The controller's own disposal closes the credential-clearing race
even when both disposal calls happen in the same turn. Connection or cancellation
failure remains an explicit error; no successful native termination is invented.

## Evidence

`tests/a19-native-task-integration.test.js` drives the actual MSBuildClient,
MSBuildTools, nativeConfiguration, BackgroundTaskBridge and TaskCenter. Its fetch
boundary returns controlled protocol responses. Cases cover live completion,
captured owners, background selection, exact failure ownership, malformed
responses, cancellation races and disposal before/after a real returned job ID.

After the complete integration scope was written, its one targeted limited run
passed all nine cases with zero failures or skips in 1.261923 seconds:

```sh
node scripts/limited.js node --test tests/a19-native-task-integration.test.js
```

The earlier 32-case background task batch was not rerun. These nine new tests do
not execute native MSBuild, an SDK, a browser or a desktop oracle. Those platform
qualifications remain separate from callback correctness.
