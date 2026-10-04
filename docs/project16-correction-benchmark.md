# Project16 Studio correction boundary measurements

Work-IDs: SF-A19-T04, SF-A19-T26, SF-A19-T35, SF-A20-T07. This harness supplies the matched Node measurements for the
compiler source eligibility and native timer receiver corrections after hosted qualification a5. The completed local
capture pair, 7/7 report-harness tests and explicit integration review are recorded in
[the correction performance review](project16-correction-performance-review.md). The comparison retains exit code 2
and three >5% case flags; reviewer acceptance does not turn that result into a performance-budget pass.

## Run the same harness against each checkout

Both checkouts must have their own ordinary workspace package links. The harness checks every package entry and declared
workspace dependency resolves inside the selected checkout before importing product code. It performs no install, link
creation, worker startup, browser run or product patch. A missing/foreign link is a setup failure, not a measurement.

Run from the integration checkout through its normal limiter, in a quiet serial slot. Use the **same absolute harness path**
for both commands. Replace `HARNESS` with that path and `CANDIDATE` with the final integrated checkout:

```sh
node scripts/limited.js node HARNESS capture --checkout /workspace/scratch/6b99131ca908/p16-master-status --output artifacts/results/boundary-before.json
node scripts/limited.js node HARNESS capture --checkout CANDIDATE --output artifacts/results/boundary-after.json
node HARNESS compare --baseline artifacts/results/boundary-before.json --candidate artifacts/results/boundary-after.json --output artifacts/results/boundary-comparison.json
```

`HARNESS` is `scripts/benchmarks/a19-correction-paths.mjs` in the checkout containing this source. The prepared baseline is
`c13aa0fd9d27df28b3708bb83d914a04c20a5c7c`, tree `29023ed8b962b6d91671bdb0c0359d905ef2659e`.
Each capture records its actual source/tree, tracked-clean status, untracked path inventory, package entry paths,
three-module harness SHA-256, Node/V8/OS/CPU/flags and start/end times. Unrelated untracked files can coexist and are
disclosed; every direct benchmark import/public package entry must be tracked. Source, untracked inventory and harness
identity are checked again afterward. This is tracked-source provenance, not a claim that the entire checkout contains
no other files. Tracked edits are rejected. Existing output files are never overwritten.

## What is timed

| Case | Actual product path | Operations per measured batch |
|---|---|---:|
| `studio.snapshot.1-source` | `StudioProjects.snapshot` using a loaded `ProjectSystem` and lazy `DocumentService` records backed by real `EditorModel` instances | 256 |
| `studio.snapshot.100-source` | The same path at the accepted source-count boundary | 64 |
| `runtime.activity.start-schedule-stop` | Public `RuntimeActivity.start()`, `schedule()`, `stop()` with default native Node timers | 256 |
| `editor.chord-prefix-cancel` | Public `KeybindingService.handle(Ctrl+K)` then `cancel()` with its default native timer clock | 256 |

Each case has one separate first-operation observation, ten warmup batches and **101 raw measured batches**.
Both source fixtures use exactly 1,024 ASCII/UTF-16 units per file, explicit compile membership, fixed versions and no
unrelated sources. Fixture construction, module loading, project loading, correctness assertions, hashing and serialization
are outside timing. The first observation retains any initial lazy text materialization; warm measurements reuse that
unchanged model state. This is not cold process or Studio startup timing.

The timer lifecycle includes normal occupancy reset/sampling setup and stop bookkeeping as well as the pump timer.
One ready-session descriptor activates the real schedule guard; no managed instructions or timer callbacks execute.
Both timer workloads synchronously cancel before yielding the event loop, using neither injected clocks nor patched
globals. Small fixed result checks inside each operation confirm registration; full assertions run afterward. Native
`Timeout` resource counts are checked outside timing after operations, after one untimed `setImmediate` event-loop turn
and after disposal. The post-turn state/callback assertions must also hold. There are no timed waits, sleeps or worker
loops. Every batch validates its last result, and each owned fixture is disposed even on failure. Snapshot assertions compare every file's
text, URI and version plus compilation options, assembly identity and diagnostics. No edit or dirty state is introduced.

## Interpretation and limits

Raw durations are integer nanoseconds from `process.hrtime.bigint()`. Summaries divide each batch by its operation count,
then use nearest-rank median/p95. First/warmup observations are retained separately and are not added to the 101 samples.
There is no explicit GC, allocation measurement, browser input/paint latency, CPU-utilization or timer firing-latency claim.
Node accepts the baseline timer receiver; the browser regressions establish why the adapter is necessary.

Snapshot work scales with selected source count and returned text size; the new eligibility pass is linear in count and
reads model-backed size metadata before text. This harness samples two eligible sizes, not an asymptotic proof or the
unsupported oversized-file path. The runtime lifecycle resets a fixed default occupancy ring and registers/cancels two
timers; the chord case resolves one fixed binding. These small operations can be noisy on shared or frequency-scaled CPUs.

A failed case retains its samples and exact error, later cases still run serially, and capture exits 1. Comparison rejects
missing scopes, invalid/nonfinite samples, mismatched correctness/fixtures/harness/environment and incomplete captures.
An increase **strictly greater than 5% in either median or p95** sets `reviewRequired` and exits 2; this requests the
contribution-guideline review and is not a significance test. Incompatible input exits 1, with a failure report.
The baseline and candidate must be reviewed together before reporting an overhead or speedup.

Pure report/parser/budget-boundary fixtures are in `tests/a19-correction-benchmark.test.js`, already owned by the existing
`tests/a19-*.test.js` glob in `tests/manifests/A19.json`. No extra runner or manifest registration is required.
