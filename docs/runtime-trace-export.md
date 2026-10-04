# Runtime event JSON export (SF-A05-T10.3, #1404)

`exportRuntimeTrace(log, {after, limit})`, exported by `@sharpforge/runtime`,
exports a bounded window from a `RuntimeEventLog`. Use `vm.runtimeEvents` when
the VM's event observer is enabled, or pass a standalone log. A disabled observer
is `null` and produces an explicit `TypeError`; exporting never enables
instrumentation. The helper accepts a log, not a VM, profiler or previously
serialized JSON object.

The result uses the existing event format without changing its schema:

```js
{
  format: 'SharpForge.RuntimeEvents/1',
  clock: 'instructions',
  sequence: 5,
  dropped: 2,
  events: [/* retained immutable event records */]
}
```

The helper delegates once to `log.export(options)`, which now accepts the same
`after` and `limit` options as `log.read()`. Default export still includes the
whole retained ring. `after` is a nonnegative safe-integer sequence cursor,
exclusive; `limit` is an integer from 1 through the log's capacity. Both options
default exactly as they do for `read()`. Invalid cursors and limits use the
existing `RangeError` diagnostics without changing the log.

`sequence` remains the whole log's latest sequence, even when a page stops
earlier. `dropped` remains the whole log's cumulative ring-overflow count; it does
not count rows omitted by the requested cursor or limit. To continue paging,
advance to the last returned event's sequence, not the page's top-level sequence:

```js
const page = exportRuntimeTrace(vm.runtimeEvents, {after: cursor, limit: 128});
if (page.events.length) cursor = page.events.at(-1).sequence;
```

Export does not pause execution or pin history in the ring. Events overwritten
between pages remain absent, with their loss visible through sequence gaps and
the cumulative drop count. An empty window preserves global metadata. Previously
exported records remain valid after the ring overwrites its slots.

Each export creates one result object and one bounded window array through one
`read()`. It reuses the log's already frozen event and scalar-payload records;
it does not clone the ring, the profiler, method metadata or event payloads.
Changing the returned array or top-level metadata cannot change the log.
Returned records are immutable and can safely be shared. Cost and temporary
references are O(U), where U is the number of returned retained events and is
bounded by `limit`. JSON stringification is a separate caller operation.

Export never flushes subscribers, advances their cursors or installs observers.
It is independent of profile sampling and duration capture. Deferred callback
failure behavior remains with the existing host `flush()` boundary.

Event order is defined by monotonically increasing `event.sequence` within one
log. `event.instruction` is the producer's instruction counter at observation,
not a wall-clock timestamp or microseconds. VM snapshot restore can rewind that
counter while host event sequences continue increasing. Export preserves both
values without sorting or rescaling. Method IDs also retain their producer's
meaning: CIL metadata tokens and source-image method indices are not the
profiler's dense method IDs. Names remain in actual retained `MethodLoad`
payloads; this export invents no name table when those records have been evicted.

This JSON uses the runtime-provider event vocabulary. Binary EventPipe and
binary `.nettrace` files are unsupported. It is not Chrome Trace Event JSON or
a Speedscope timeline, and does not claim native trace-tool import compatibility.

Run the direct-CIL example:

```sh
node examples/runtime/trace.mjs > trace.json
```

Program output goes to stderr; stdout contains only JSON. The same helper accepts
any source or reloaded-source observer log when those independently delivered
event producers are integrated. No engine adapter or guest snapshot field is
added by this leaf.

`tests/a05-runtime-trace-export.test.js` contains authored cases for bounded
reads, default/empty windows, paging and eviction, immutable ownership, replay
and callback isolation, invalid inputs, counter rewinds, and a real direct-CIL
call/snapshot/stop lifecycle. The helper and example have not been executed in
this slice; serial Node validation and browser/platform qualification remain
pending. No performance or external-tool import result is claimed.
