# Complete VM snapshot state — A05 T06

The in-memory schema is **4**. Portable transfer uses format **1**. In-memory snapshots belong to one VM
and source-image or assembly-inspector generation. Portable export records a code hash, entry point,
native integer ABI and host-operation revision; import can rebind the graph to a fresh VM running the
same code. Unsupported in-memory versions raise `SnapshotVersionError` with
`code = 'SNAPSHOT_SCHEMA_VERSION'` before replacing execution state. Portable failures use
`SnapshotFormatError` and a specific `code`.

## Captured state and ownership

| State | Contents and restore treatment |
| --- | --- |
| Frames and evaluation | Active and parked frame arrays, locals, arguments, evaluation stacks, PC, prefixes, unwind/filter state, pending intrinsic continuations and frame lifetimes |
| Heap | Record data and MethodTable identity, generations, free slots, strong/weak handles, accounting and collection threshold |
| Scheduler | Contexts, runnable order, waiting tasks/timers, faults, cancellation and asynchronous continuation state |
| Synchronization | Monitor owners/recursion, queues, wait flags, atomic state and logical context relationships |
| Memory | Stack regions, frame leases, owned interior/raw pointers, Span/read-only views, pins, typed references and varargs packets |
| Common VM fields | Statics, type objects, pending/current faults, output, return/exit state, instruction/time counters and write notification state |
| Source-specific fields | Operand stack, string pool, constant cache, debugger pause and current sequence point |
| CIL-specific fields | String pool, initialized types and generic instantiation keys |
| Excluded host/derived state | Host callbacks/options, external resources, immutable code metadata, vtables, layout/frame indexes and stack accounting; derived indexes are rebuilt |

`packages/runtime/src/snapshot.js` contains the authoritative field registration. Unclassified VM fields
fail capture. Restore validates the saved graph, including cross-component relationships, before replacing
live state. A malformed restore must not change the destination's frame or heap identities.

A single copy memo preserves aliases among frames, parked contexts, task faults, heap payloads and VM
fault fields. Frozen wrappers do not make mutable children immutable: Maps, arrays and faults still copy
through that memo. COW capture preserves aliases when reused records and changed records share frozen
payloads. Restore removes snapshot-only read-only backing once, preserving shared and cyclic mutable
payloads. Frame IDs, heap generations, scheduler IDs, memory sequence numbers and host handle IDs remain
monotonic after rewind so discarded future references cannot alias later allocations.

## Capability and evidence map

The implementations and fixtures below are staged. Full E01 execution, browser/native comparison and
performance qualification remain deferred; this table is not a passing test report.

| Capability | Source / reloaded source / direct CIL | Deferred evidence |
| --- | --- | --- |
| Seeded arbitrary instruction boundaries | Same-VM and fresh-VM replay, nested calls/catches/finally | `tests/a05-06-replay-fuzz.test.js` (16 reproducible seeds per engine) |
| First-chance faults and nested finally calls | Pending fault/unwind replay | `tests/snapshot-replay.test.js`, browser snapshot suite |
| Awaited contexts after cancellation and GC | Internal timers/tasks transfer to a fresh VM | Replay tests and browser snapshot suite |
| Stack memory, read-only Span, pins, Nullable/value copies | Lifetime and owner rebinding with positive/negative preflight cases | `tests/a05-snapshot-memory.test.js`, `tests/a05-snapshot-memory-invalid.test.js` |
| Synchronization and long-running array intrinsics | Shared snapshot graph and continuation preflight | Snapshot-state, synchronization and preemption suites |
| COW lifecycle and alias topology | Changed-record copies, stable unchanged records, cache eviction and full-copy restore | `tests/a05-snapshot-cow*.test.js` |
| Portable JSON / structured clone | Same code and ABI, fresh VM identities | Portable tests, `tests/browser_snapshot_suite.js` |
| External operations | Active operation blocks capture; completed revision blocks older/fresh-VM history | Actual controlled `HostOperations` browser case |
| Rust native/Wasm snapshot backend | No equivalent snapshot implementation is claimed by this JavaScript scope | Separate backend qualification remains required when implemented |

External callbacks and resources are not serialized or reopened. A fresh VM cannot import a history with
an irreversible external-operation revision it has not observed. Source restore enters its debugger pause
state; `run()` resumes it. Direct CIL retains the captured state, so callers resuming a deliberately paused
capture set `state = 'running'`. Logical cancellation followed by restore can replay internal work but does
not revive a disposed external transport.

## Deferred measurement commands

Run these only when the parent E01 integration is ready for qualification, using the repository-supported
Node release. Commit the assembled implementation first so reports identify exact code. Each script saves
failures and available raw samples instead of silently dropping a failed case.

```sh
node scripts/benchmarks/a05-snapshots.mjs artifacts/a05/snapshot-latency.json
node --expose-gc scripts/snapshots/benchmark-cow.js artifacts/a05/snapshot-cow.json
node scripts/benchmarks/a05-memory.mjs artifacts/a05/memory-latency.json
node examples/runtime/portable-snapshot.mjs
node scripts/prepare-a05-browser.js --output artifacts/a05-e01-browser
python3 tests/browser_e01_test.py --browser chromium --artifacts artifacts/a05-e01-browser
python3 tests/browser_e01_test.py --browser firefox --artifacts artifacts/a05-e01-browser
python3 tests/browser_e01_test.py --browser webkit --artifacts artifacts/a05-e01-browser
```

Latency reports include the first iteration, all warmup and measured iterations, median/p95/p99, managed
allocation counters, engine, ABI, script hash, commit, working-tree diff hash and tool/platform versions.
They measure one existing process, not fresh-process startup. Managed counters do not measure host graph
allocation; snapshot restore rewinds counters, so portable destination initialization is reported separately.

The COW retention workload starts above 10 MiB and retains 128 captures. Each revision changes one slot in
1% of live **records** while large immutable payloads remain shared. The acceptance estimate includes unique
record payloads and record/generation vectors, with measured host memory recorded separately. It does not
claim a universal below-2x bound when 1% of all payload bytes are changed at every revision. All 128 states
are restored and compared with a full-copy reference digest. The report includes COW capture, full-copy
capture and restore raw timing distributions; it does not claim a speedup before measurement.
