# Managed-reference latency evidence

Original Project 7 issue #76 includes the requirement: “Measure cold/warm
latency, p95/p99 and allocations for performance-sensitive paths; keep
correctness gates.” The standalone `bench/vm/byref-latency.js` driver adds that
measurement without modifying the T12 or optimization-target fixtures.

The fixed workload makes 256 complete calls through four recursive levels and
a leaf method. Each leaf updates a caller-local reference, an array-element
reference and an object-field reference. Four explicit guest collections occur
inside the leaf while those references remain live. The expected output is
exactly `256`, `512`, `768`, each on its own line. Every observation must execute
the same positive guest instruction count for its engine, retain at least the
four requested collections and match that output.

All three routes run: compiler source image, assembly-reloaded source image,
and compiled direct CIL. The report records input/backend identity, source and
assembly hashes, VM options, revision, runtime, resource controls and raw samples.
This is JavaScript VM measurement, not a newly executed native CLR oracle.

Cold observations use a fresh VM and report construction/loading, explicit
preparation, first complete execution and their total separately. Source
compilation is performed once and reported outside those runtime phases.
The same compiled artifact is reused in one Node process; these are VM-cold
observations, not process-cold startup or repeated compiler measurements.
Cold counters cover constructor, preparation and execution. Warm observations
use one prepared VM per route without restore or code invalidation. The first
execution and configured warmups remain in the report and are excluded from
warm summaries. Repeated entry-frame admission is inside the warm timer.

Both distributions report p50/median, p95 and p99, plus exact managed allocation
and byte counters, collection counts and frame/frame-array allocation counters.
They do not count host JavaScript objects. Host memory fields are separately
labeled process gauges; they are not allocation totals. Exposed host GC runs
outside timers, while guest GC remains inside each complete execution.

Run on a clean committed tree in the serial validation slot:

```sh
SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --expose-gc bench/vm/byref-latency.js \
  --runner a05-linux-x64-node24 --native-bits 64 --samples 100 --warmup 10 \
  --timeout-seconds 900 --out /absolute/new-byref-latency-report.json
```

The timeout applies independently to each route. The driver refuses an existing
output path, retains partial failed rows and rejects changed/dirty measurement
revisions. Reported distributions have no invented performance threshold and
are not a T12 baseline. Execution and measurement remain pending until their
actual reports are retained. Reduced focused-test observations validate the
harness contract only; they are not qualification measurements.
