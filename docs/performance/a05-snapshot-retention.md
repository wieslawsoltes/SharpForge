# Snapshot retention qualification protocol

Issue #1387 asks for 128 consecutive snapshots of a 10 MB heap with 1% mutation,
retaining less than twice the heap size, with restore parity against full copies.
It does not specify whether mutation is counted in records or bytes, or whether
the retained size includes the live heap. This protocol reports those quantities
separately and does not treat one favorable workload as a universal pass.

The existing test uses 4096 immutable strings and 4096 two-slot objects. Each
snapshot changes the integer slot in 82 objects, rotating through those objects.
That is approximately 1% of all records, with large string records unchanged.
The heap exceeds 10 MiB under managed accounting. It is not a 1%-of-bytes test.
The original workload is retained exactly as `original-records`.

Two additional workloads each contain 100 primitive byte-array records with
100,000 payload bytes per record: exactly 10,000,000 bytes, or 10 decimal MB,
plus 3,200 bytes of managed record headers. Each revision changes 100,000 bytes
to a new value, exactly 1% of the payload. `concentrated-bytes` changes the same
complete record each time. `distributed-bytes` changes the first 1,000 bytes of
every record each time. All 128 distinct revisions remain retained concurrently.

These are record-distribution experiments. The current implementation shares
whole immutable record images; it does not subdivide arrays into COW pages.
Without byte deltas or deduplication, its representation is expected to retain
227 record payloads in the concentrated workload and 12,800 in the distributed
workload. Those are explanatory predictions, not measurements or general claims
about what another snapshot representation can achieve. No mutation fraction is
silently weakened to make the requested bound pass.

Each workload runs in a fresh Node child with explicit GC enabled. The child
warms a small capture/restore, takes a post-GC empty baseline, constructs the live
fixture, then captures all versions. At every reported boundary it runs three
full `gc()` calls separated by event-loop turns. Raw `process.memoryUsage()`
values include `heapUsed`, `heapTotal`, `external`, `arrayBuffers` and `rss`.
`heapUsed + external` is reported as an additive host metric; `arrayBuffers`
is a subset of `external` and is never added a second time. RSS and allocator
reservations are reported separately from net retained bytes.

The report includes the retained-history delta over the live baseline and the
combined live-plus-history delta over the empty baseline. A separate identity
census counts unique snapshot records, unique private typed backings, and their
exact bytes. Each `ReadonlySnapshotArray` owns one distinct private buffer;
ordinary typed views are deduplicated by their shared ArrayBuffer identity.
Managed record sizes and eight-byte index-slot estimates remain explicitly
logical counts. They do not describe V8 headers, compressed pointers, strings,
ropes or allocator overhead. The existing original fixture can therefore have a
different host-retention ratio from its logical ratio.

Retention is sampled **before** restore validation allocates reference heaps.
For every captured revision, an independent fixture replays the same mutations,
takes a full-copy snapshot, and restores it. Its restored bytes, fields, types,
generations, counters and heap statistics are compared with restoration of the
shared version. Full-copy reference versions are released per iteration, so the
comparison does not itself retain another 128-version history. The report includes
the number of compared revisions and a SHA-256 digest of the compared state.

At the exclusive measurement slot, use a clean committed worktree and an output
path outside that worktree:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 node scripts/limited.js node bench/vm/snapshot-retention.js --runner linux-node-local --out /tmp/a05-snapshot-retention.json --max-retained-mib 1536
```

The distributed case can retain approximately 1.28 GB of typed snapshot data
with the current representation. The child also has a 512 MiB V8 old-space limit,
a five-minute timeout and an explicit post-GC host-retention cap. A cap-triggered
run records its actual capture count and is **incomplete**, never passing.
For a smaller safety limit, pass `--max-retained-mib 256`; for one workload, pass
`--scenario original-records`, `concentrated-bytes`, or `distributed-bytes`.

Exit code 0 means the measured workload rows individually meet the reported host
bound; 2 means at least one row misses or is incomplete; 1 means the probe failed.
The row assessment uses the snapshot increment over the live baseline; the
combined live-plus-history ratio is also reported and is never substituted for
that assessment without an explicit interpretation of the issue's requirement.
None of these exits grants a universal or cross-platform qualification. The probe
exercises the ManagedHeap shared by source and direct CIL engines; it does not
qualify whole-VM frame retention, browsers, Wasm hosts, or native .NET snapshots.

Authoring checks and protocol unit tests are separate from measurement. The
[2026-10-04 observation](https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/snapshot-retention-2026-10-04/README.md)
records the actual clean Node/Linux original workload: 128 matching restores,
1.134337× managed-heap host-history increment, and 1.468457× combined increment.
The separate distributed-byte run hit the 256 MiB cap at 23 versions and remains
incomplete. The concentrated-byte workload remains unmeasured. These are
workload-specific observations, not a universal or cross-platform bound.
