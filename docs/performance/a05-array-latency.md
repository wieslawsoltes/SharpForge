# Complete array latency and allocation evidence

Original Project 7 parent #78 requires: “Measure cold/warm latency, p95/p99 and
allocations for performance-sensitive paths; keep correctness gates.” Its
deliverable is rank/bounds/lower-bound semantics and typed array covariance
checks. Existing native and regression fixtures cover failures, lower bounds and
covariance. This additive report supplies complete successful rectangular and
vector array work without introducing a speed threshold or changing T12.

`bench/vm/array-latency.js` reuses the exact canonical fixtures from
`bench/vm/fixtures.js`:

- `grid`: allocate `int[8,8]`, write and read all 64 cells through two indices,
  and print the full sum `2016`.
- `arrays`: allocate and initialize `int[256]`, scan all 256 cells 80 times,
  and print the full sum `2611200`.

Both run independently through source, canonical source reload and direct CIL,
with actual engine/input identity, source/assembly hashes, exact output and
positive invariant guest-instruction counts. The matrix contains six rows. The
sources and expected results are shared with the existing T12 catalog; no row,
option, threshold or workload in its 36-row protocol is changed.

The complete-execution loop is shared with the managed-byref latency harness.
That wrapper retains its existing four-guest-collection requirement; array rows
record collections without inventing a required count. Every VM is stopped in
`finally`, including guest failure and cancellation.

Each cold observation creates a fresh VM, explicitly prepares it and completes
the entire guest program. Construction/loading, preparation, execution and their
total are retained separately. Compilation occurs once per fixture and is
recorded outside those phases. These are VM-cold observations in one Node process
using shared compiled artifacts, not process-cold startup measurements.

Warm observations retain one prepared VM per fixture/engine. First execution and
the configured warmups are recorded and excluded from the measured summaries.
Every complete reentry includes frame admission inside its execution timer and
allocation interval; no snapshot restore or invalidation occurs between samples.
Cold and warm summaries independently retain p50/median, p95 and p99.

Managed allocations/bytes, collections and frame/array allocations are exact VM
counter totals or deltas. Cold totals cover construction through completion;
warm deltas include repeated entry admission. Host-memory fields remain process
gauges, not total JavaScript allocations. Exposed host GC occurs before each
observation outside its timer; guest collections remain inside execution.

Run only in the coordinator's serial measurement slot on a clean committed tree,
with a new output path for every attempt:

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --expose-gc bench/vm/array-latency.js \
  --runner a05-linux-x64-node24 --native-bits 64 --samples 100 --warmup 10 \
  --timeout-seconds 900 --out /absolute/new-array-latency-report.json
```

The deadline bounds the complete report. CLI samples accept 20–1000 and warmups
1–100; native width is explicit, and output overwrite is refused. Reports retain
the exact command, clean start/end revisions, runtime/resource fingerprint and
harness hash. New harness files change future harness fingerprints; old reports
retain their original scope and hashes.

No timing result is claimed until the prescribed report runs. This harness does
not measure CLR throughput, browser timing, arbitrary array ranks/lower bounds,
exception timing or every System.Array method. Those correctness contracts retain
their independent test/native evidence. A successful row is not a T12 baseline
or a claim that every Project 7 array criterion is complete.
