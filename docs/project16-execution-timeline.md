# SF-A19-T26 — Per-application execution timeline

The Diagnostics tool now records real execution intervals for each committed Studio runtime launch. Its Summary, Events, Memory Usage and CPU Usage views share the application selector and a separate captured-launch selector. Retained earlier launches stay available when an app restarts. Heap snapshots retain the runtime census stamp; comparisons require two snapshots from the same composite launch identity and report object and byte deltas by managed kind and type.

## Measurement contract

The CPU Usage view labels its metric **Worker execution occupancy**. It measures synchronous wall time spent in the managed execution pump, managed UI operations and debugger operations that execute managed work. The sum is divided by the actual elapsed wall time of the sampling interval. It measures the source JavaScript VM and direct JavaScript CIL VM used by Studio. It is not an operating-system process CPU counter, CLR attachment, native hardware sample or call-stack profiler.

The worker starts the clock only after a replacement launch candidate has been validated and committed. Assembly decoding and launch preparation are outside the metric. Source/heap inspection and asynchronous waiting are outside the measured numerator. Paused applications produce zero-occupancy intervals unless a measured debugger operation runs. Browser scheduling, garbage collection and synchronous host work inside a measured operation can affect its duration; the label describes this wall-time measurement rather than claiming OS CPU utilization.

The default interval is 250 ms, using `performance.now()`. A delayed timer records its actual interval, not an assumed 250 ms. The worker forces a final partial interval at application termination or explicit stop, including when termination occurs inside a measured UI/debugger callback. Stopped captures remain readable. Nested measured callbacks count once under their outer operation. There is no instruction-level instrumentation or allocation per managed instruction.

The readonly `executionMetrics` worker request accepts `{sessionId, after, limit}` and returns:

```js
{
  metric: 'worker-execution-occupancy', sessionId, intervalMs, active,
  sequence, firstSequence, truncated, totalBusyMs,
  samples: [{
    metric: 'worker-execution-occupancy', sessionId, sequence,
    startMs, endMs, durationMs, busyMs, occupancyPercent,
    managedMs, uiMs, debuggerMs
  }]
}
```

All times are milliseconds; sample times are relative to the committed launch. Sequence numbers begin at 1. A new launch clears the previous worker ring and uses its new raw runtime serial. `truncated` reports that samples older than the ring have expired. The tool draws a gap rather than connecting missing intervals. Mean occupancy weights each actual interval duration.

## Ownership, bounds and cancellation

`RuntimeActivity` owns the pump, animation and sampling timers. Every callback checks the committed launch serial before changing timer state. A retired callback cannot clear a replacement launch's timer. Stop clears all three timer kinds. Existing waiting-pump delays, manual animation behavior and paused animation behavior are preserved.

`ExecutionCapture` polls sessions serially, at most 64 applications, one readonly request per app per poll, 256 samples per request and a 3-second request timeout. The default poll interval is 1 second. It passes the composite `AppSession.identity` through the existing session service and validates the raw worker serial returned in every header/sample. It also captures identity before awaiting the request. Late replies after replacement, cancellation or disposal cannot enter the new history.

The worker retains 2,000 samples (about 500 seconds at the default interval). The UI retains at most 128 launch histories, each with 2,000 CPU samples, 2,000 delivery-time event descriptors, 2,000 managed-memory samples and 20 heap snapshots. Event descriptions are bounded to 2,048 characters; output, source and UI command payloads are not retained by the timeline. Heap census input is bounded to 10,000 types and validated before committing a snapshot. Capture errors are visible in the selected history. A malformed or unsupported provider is blocked for that launch; a replacement launch may retry.

Pause CPU updates cancels the current UI wait and stops polling. It retains previous samples and resumes from the last accepted cursor. The bounded worker ring continues measuring while the app is alive. The menu does not imply that pausing display capture pauses the managed application.

Events use delivery time since the host first observed the launch; CPU uses the worker's launch-relative clock. The two axes are labeled separately. Memory comes from actual runtime state/heap statistics and snapshots from actual `heapCensus`; the tool does not estimate missing memory or execution samples.

## Qualification

Focused tests cover deterministic interval arithmetic, nested work, partial final intervals, ring rollover, invalid clocks and cursors, stale timer callbacks, paused/manual animation behavior, strict response validation, equal raw serials across two applications, restart/cancellation/disposal, bounded histories, census stamps/diffs and graph accessibility descriptions. Real worker tests execute the actual source and direct CIL worker routes with only browser message transport adapted to Node, checking output and isolation.

`tests/bench/a19-execution-occupancy.mjs` compares the same managed pump workload with and without the measurement wrapper, alternating run order. It records machine, actual backend, raw samples, median and p95. It does not claim allocation counts without an allocation profiler or substitute for browser frame-time qualification. Run the focused test scope and benchmark through `node scripts/limited.js` only after the complete implementation is ready.

At source `364023a3`, all 23 measurement, capture and actual worker cases passed in the complete nine-file provider scope. Existing runtime-launch and animation regressions also passed. The full scope had 134 passes out of 136 cases; its two unrelated metadata failures were subsequently corrected and qualified in affected runs. Exact logs and overlapping cohorts are recorded in `docs/project16-shell-provider-evidence.json`.

Post-batch review corrected a graph edge case at `379321a3`: a short app's single partial interval now draws a visible segment from its actual start to end. The updated existing graph assertion is included in the root's next integrated gate; this source correction is not described as already executed by the shell lane.

The matched pump benchmark ran at `3b3f6546`, with three warmups and nine alternating samples per backend on Node 24.19.0, Linux x64, an AMD EPYC 9V74 host with nine logical processors visible. Other agents share this machine. Raw samples and environment are in `docs/evidence/project16-shell-providers/execution-benchmark.json`.

| Actual backend | Bare median | Instrumented median | Bare p95 | Instrumented p95 |
| --- | ---: | ---: | ---: | ---: |
| Source JavaScript VM | 9.287 ms | 8.652 ms | 14.830 ms | 12.557 ms |
| Direct JavaScript CIL VM | 102.835 ms | 101.068 ms | 107.781 ms | 109.537 ms |

These samples show no median regression. Direct CIL p95 increased by 1.63%. The observed lower medians do not establish a speedup, and no allocation profiler ran. Browser layout/interaction qualification and native OS CPU measurement are separate from the implemented worker measurement.
