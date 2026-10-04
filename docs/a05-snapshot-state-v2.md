# A05 coherent execution snapshots, schema 2

Work items: SF-A05-T06.1 / #1386 and SF-A05-T06.4 / #1389.

Schema 2 captures one graph across heap records, active frames, parked scheduler
contexts, pending faults, task continuations, static initialization, generic
instantiation keys, platform singleton/window handles, animation state and
pending UI work. Source and CIL share the graph copier. Immutable managed
references and owned value carriers preserve their identity; mutable state gets
an independent copy. The active scheduler context shares the exact same frame
array (and source evaluation stack) as the VM in both capture and restore.

| API | Contract |
| --- | --- |
| `vm.snapshot()` | Capture a local owner-scoped schema-2 execution image. |
| `vm.restore(snapshot)` | Preflight captured state, prepare detached storage, then replace all execution components. |
| `snapshotSchemaVersion` | Public current schema version; equal to `2`. |
| `SnapshotVersionError` | `TypeError` subclass with code `SNAPSHOT_SCHEMA_VERSION`. |
| `scheduler.restore()` | Reject independent scheduler restoration; use `vm.restore()` to restore lifetime ownership with the heap. |

Restore rejects a foreign VM, replaced code owner, native-width mismatch,
incompatible schema, missing required field, invalid heap accounting,
generation mismatch, malformed scheduler row, duplicate frame identity and
broken active/current aliases before publishing replacement execution state.
Captured memory validation resolves saved handles and frame locations against
**captured** records, so collecting an object in the currently running heap does
not invalidate an older snapshot that retains it.

Host callbacks and configuration stay attached to their VM. Pending external
operations prohibit capture. A different external-operation revision prohibits
restore. Capture during a platform transaction or an animation update is
rejected because that host boundary has not committed. Rendering reset callbacks
are delivered after the execution state commits; a throwing host callback is
not a malformed-snapshot rejection and does not roll back committed guest state.

Generic caches are represented by `[MethodDef, declaringType, methodArguments]`
keys. Decode resolves them in a separate execution cache, and successful restore
replaces derived code caches for both source and CIL. Vtables, verifier/decode
plans, profiler adapters, Wasm functions and frame-pool entries are not serialized
execution state. Restored typed numeric arrays are rebuilt through the existing
runtime helper. Allocation, frame, memory-region and host-handle counters remain
monotonic so a retained future handle cannot become a restored object's handle.

## Scoped memory and terminal history

Frame-owned stack regions carry independent `Uint8Array` backing and positive,
monotonic allocation IDs. Pin leases require a matching captured strong handle,
primitive array owner and live captured frame. Preflight validates these maps
before resolving raw pointer offsets, reinterpretation source types or complete
Span ranges. Empty Spans may point one element beyond an array; reading a value
through a typed reference to that position remains invalid. Primitive backing
must match the exact array element ABI, and rectangular shape metadata must
describe the captured row-major payload exactly.

All rejecting checks and allocations complete before successful restore releases
the abandoned live frame regions and pins. The captured graph owns independent
region bytes and lease state, so collection or cancellation of current execution
cannot destroy saved storage. Failed restore preserves the existing capabilities.

Completed and canceled scheduler rows are diagnostic history, consistent with
the collector's root inventory. Their references must belong to the owning VM,
but a historical reference may already have been collected. Live task state and
references retained by heap records still require valid captured generations.

Exception preflight validates handler metadata, instruction locations, filter
owners, catch ranges and the alias between pending cleanup and its saved fault
search. Async builder, exception-event and varargs validators share the same
captured graph. Monitor queues must agree with the saved task waiter lists and
waiting contexts; lock-taken flags must address writable Boolean storage.

Synchronization is created lazily. A portable image containing monitor state
prepares the missing destination component before commit. Restoring an earlier
image without synchronization clears a component created later. No monitor
callback, task completion or managed handler executes during preflight.

## Verification

Focused authored coverage: `tests/a05-06-coherent-snapshot.test.js`; existing
coverage: `tests/a05-seams-snapshot.test.js`, managed-address, stack-budget,
frame-pool and scheduler/context suites. The deterministic replay fixture uses
24 seeded instruction boundaries for each engine, replaying every image twice.
`tests/a05-06-memory-snapshot.test.js` covers local and portable stack/pin/Span
replay after collection, old-capability retirement, rejected graph atomicity,
wrong primitive backing, malformed shapes and destination stack-memory quotas.
`tests/a05-06-control-replay.test.js` covers first-chance faults, nested finally
calls, awaiting contexts after collection, and portable contended monitor state.
`tests/a05-06-array-replay.test.js` resumes partial Copy/Clear work from captured
owners after cancellation and collection, and rejects malformed work cursors.

Validation is pending the Project 7 serial slot. No browser/native/platform
qualification or latency/host-allocation result is claimed by this document.
Control-flow and captured stack-region validators are integrated in their owning
batches and qualified on the final combined revision.
