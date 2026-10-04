# CIL collection events

The existing `runtimeEvents: true` option now records `GCStart` before a managed
heap collection and `GCEnd` after its successful sweep. This includes explicit
collections and allocation-threshold collections. Profiling is independent and
does not need to be enabled. Standalone heaps and source VMs do not gain a log.

Start payloads contain `{collection, liveBytes, liveObjects}`. End payloads add
`freedObjects` and `freedBytes` for that collection. These are logical managed
heap statistics, not process memory or native GC measurements. Event timestamps
use the current CIL instruction count. No managed handles or heap records enter
the payload, and logging cannot keep guest objects alive.

Subscribers remain deferred to the existing host flush boundary; they do not run
inside marking or sweeping. A failing root provider can leave a start without
an end, because collection did not complete. No successful completion is invented.
The bounded log can discard older events, including one half of a pair, under
its existing capacity policy.

Host log history and subscriptions survive same-VM restore. Heap counters rewind
with guest state, so collection numbers may repeat after restore; event sequence
numbers remain the chronological identity. No VM, heap or snapshot fields are
added for the observer. With events disabled, no payload is constructed.

The collector was mechanically extracted from the legacy heap class, preserving
root order, generation checks, sweep order, statistics and threshold policy. CIL
instrumentation initialization is similarly extracted without changing profiler
or tiering option order. This is a partial #1403 increment; allocation, exception
and scheduler events and broad platform/performance qualification remain separate.

Focused tests are authored in `tests/a05-gc-events.test.js`; execution is queued
serially. No allocation, pause-time or throughput improvement is claimed.
