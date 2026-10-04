# Source Fibonacci CPU diagnostic at 48c62243

This diagnostic profiles the unchanged `source-fibonacci` fixture at exact clean
revision `48c62243ef4cf614dfcafdb7af9a7ce360b643c4`. It follows the retained
[20- and 100-pair qualifications](../source-fibonacci-2026-10-04/README.md), both
inconclusive against 1.5×. CPU sample shares identify optimization candidates;
they do not establish a speedup or qualify the performance target.

The archived driver creates one persistent source VM per mode using the target's
existing `baselineOptions` / `candidateOptions` and `qualificationVmOptions` with
`nativeBits:64`. It retains the existing execution driver, source program, result
check, 10,000-instruction / 8 ms slice budgets and exposed host GC outside guest
execution. Four alternating warmup pairs precede 20 profiled observations per
mode. Each mode executes **5,253,940 guest instructions** and verifies expected
output. V8 sampling interval is 100 microseconds. The driver verifies the exact
clean checkout before and after profiling.

Raw profiles contain Inspector start/stop work. `guest-attribution.json` retains
only samples with a `runQualificationVM` ancestor and attributes `timeDeltas` to
self and inclusive call frames. This yields 5,179 candidate guest samples
(889.059 ms attributed) and 7,289 baseline guest samples (1,276.476 ms attributed).
The raw unfiltered summary remains available separately as `summary.json`.

| Candidate function | Guest self sample time |
| --- | ---: |
| `scrubPreparedSourceFrame` | 18.45% |
| `executeSourceBlock` | 14.51% |
| `FramePool.flush` | 10.80% |
| `FramePool.#acquireBucket` | 9.42% |
| `executeSourceFusionBatch` | 7.02% |
| `executePreparedSourceCall` | 6.61% |
| `uint32Binary` | 5.78% |
| `returnSourceBlock` | 4.41% |
| `executeSourceFusion` | 3.47% |
| `flushFramePool` | 3.34% |

The baseline's largest self shares were `FramePool.flush` (26.65%), ordinary
`executeInstructions` (17.29%) and `callSourceFrame` (8.60%). The candidate still
spends substantial time clearing frames and checking flush boundaries. This
motivates testing a cold call/return block marker and an actual-current-pool
pending-retirement check to avoid empty flush dispatch after scalar blocks.
Faults, calls/returns and any pending retirement keep the existing flush boundary.
This is a proposed optimization derived from the profile, not measured evidence
for the follow-up implementation.

The A05 serial slot was explicitly granted for this run; no other A05 heavy job
ran concurrently. The command, from the immutable qualification checkout, was:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 \
SHARPFORGE_TEST_CONCURRENCY=1 \
SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --expose-gc \
  /workspace/scratch/42f7738360b9/a05-source-profile-48c62243.mjs
```

`profile-driver.mjs` is the exact archived driver, including its original
workspace-relative imports and output path. `traces.tar.gz` contains all 40 raw
profiles without edits. `manifest.json` records SHA-256 values and byte counts
for the archive, reports, driver, log and each original trace member.
