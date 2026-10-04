# A05 shared heap snapshots

Work item: SF-A05-T06.2 / #1387.

`ManagedHeap.snapshot({ shared: true })` (the default) shares immutable record
images across consecutive captures. `snapshot({ shared: false })` retains the
full-copy comparison path. Both produce the same restorable managed state.
`heap.lastSnapshot` reports the preceding capture's `reusedRecords` and
`copiedRecords`; these are operation counts, not a memory profiler estimate.

The cache uses weak live-record keys. Collection therefore does not keep dead
live records reachable through the snapshot cache, while already captured images
continue to own their replay data. Slot reuse always gets a new live record and
managed generation. Restore keeps generation and host-handle counters monotonic.

Primitive typed backing is held by `ReadonlySnapshotArray`, whose bytes are
private. Its `toMutableArray()` produces an independent copy. Mutable host graphs
are copied with their cycles and aliases preserved and are not eligible for
record sharing. Restore first prepares a completely detached mutable heap image.

Different typed views over one buffer, partial views, and direct backing aliases
held by execution state or host handles use the full-copy path. Their offsets
and shared buffer identity survive local and portable restore. Ordinary guest
primitive arrays remain eligible for immutable record sharing. Freezing an
`ArrayBuffer` object does not freeze its bytes, so it is never treated as an
immutable owned value by the record cache.

## Cost and compatibility

Capture visits each live record and conservatively compares its host-writable
payload with the previous immutable image. Existing integrations can retain
`heap.get(reference).data` and mutate it without calling a runtime write helper;
version stamps alone cannot prove that such backing has not changed. Thus
capture remains O(record count + compared payload), while retained snapshot
payload and allocation volume depend on changed records. No constant-time
capture or measured latency speedup is claimed.

The regression fixture retains 128 snapshots of a heap exceeding 10 MiB while
changing 1% of its records at each capture. It sums unique managed record sizes,
snapshot record-index slots and shared generation-index slots, and requires less
than twice the original managed heap bytes. That is a **logical retained-data
bound**, not RSS, JS allocator overhead or a promise for every distribution of
record sizes. In particular, changing 1% of every byte at every capture can
legitimately retain more than two heaps over 128 captures.

The separate [host-retention protocol](performance/a05-snapshot-retention.md)
preserves this original workload and adds concentrated and distributed exact
1%-of-payload-byte mutations. It records explicit-GC host counters, exact unique
typed backing, logical estimates and full-copy restore equivalence separately.
The [2026-10-04 clean Node/Linux measurement](a05-evidence/snapshot-retention-2026-10-04/README.md)
retained all 128 original-workload versions with 1.134337× managed-heap host-history
increment and identical full-copy restores. The supplemental distributed-byte
run stopped at 23 versions under the explicit 256 MiB cap and is incomplete.
This establishes a bound for the original workload, not arbitrary byte mutation.

## Verification

Authored focused coverage: `tests/a05-06-snapshot-cow.test.js` covers sharing,
full-copy parity, mutable cycles/aliases, NaN payload bits, retained host writes,
GC slot reuse, monotonic identities and the stated retention fixture.

Validation is pending the Project 7 serial qualification slot. Planned command:

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 node scripts/limited.js node --test tests/a05-06-snapshot-cow.test.js
```

Browser/native/Wasm host measurements and cold/warm latency, p95/p99 and host
allocation measurements are pending; authored tests are not passing evidence.
