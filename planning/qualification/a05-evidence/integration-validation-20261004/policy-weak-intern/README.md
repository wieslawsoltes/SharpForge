# First-chance policy and weak-intern snapshot repair validation

These are the two original, byte-identical passing logs from the serial validation
slot used to repair the nine first-chance policy snapshot failures. The root's
earlier 117-test attempt remains preserved separately: it reported 107 passes and
10 failures, including a separate missing native capture fixture outside this
repair.

| Selection | Tests | Passed | Failed | Skipped | Duration |
|---|---:|---:|---:|---:|---:|
| [Policy and weak-intern snapshots](a05-policy-weak-intern-r1.log) | 33 | 33 | 0 | 0 | 3,497.508239 ms |
| [Existing snapshot and event regressions](a05-policy-snapshot-regressions-r1.log) | 70 | 70 | 0 | 0 | 7,886.018 ms |

These selections contain 103 distinct tests. They are focused Node correctness
evidence, not a complete repository run, native execution, browser qualification
or performance measurement.

Both commands ran from `/workspace/scratch/42f7738360b9/a05-memory` with Git HEAD
`bf6197349c275e1b5ccac97c854ed5323c147208`. That commit's tracked tree is identical
to integration revision `3fd119f21`. The repair was still uncommitted: it modified
`packages/runtime/src/snapshot.js` and added
`packages/runtime/src/execution/snapshot-strings.js` and
`tests/a05-weak-intern-snapshot.test.js`. Those exact three files were subsequently
committed as `2cf5a3d23e1320cca27bcc538e88a6fc5c4f6704`, with no intervening source
or test edits. This is source-equivalence evidence for the later commit, not a
claim that the tests ran from a clean checkout of that commit.

[manifest.json](manifest.json) records full revisions and tree identities, the
repair patch digest, SHA-256 and Git blob identities for 25 relevant source/test
files, original log paths, exact commands and resource overrides, and byte counts
and hashes for both untouched logs. The commands explicitly set test concurrency
to one and configured one heavy run and a 512 MiB old-space cap. Node 24.19.0,
V8 13.6.233.17-node.51 and host details were recorded from the same workspace when
archiving; the raw logs themselves do not embed per-run environment or heap-gauge
samples. The manifest distinguishes that archive-time observation from execution
provenance. No independent child-exit-code sidecar was captured, so the recorded
passing outcomes come from the complete Node test summaries.

The actual commands were:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a05-first-chance-unwind-policy.test.js \
  tests/a05-weak-intern-snapshot.test.js \
  > /workspace/scratch/42f7738360b9/a05-policy-weak-intern-r1.log 2>&1

SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a05-06-memory-snapshot.test.js \
  tests/a05-06-coherent-snapshot.test.js \
  tests/a05-06-portable-snapshot.test.js \
  tests/a05-06-snapshot-json.test.js \
  tests/a05-06-snapshot-cow.test.js \
  tests/a05-exception-event-policy.test.js \
  tests/a05-source-appdomain-events.test.js \
  > /workspace/scratch/42f7738360b9/a05-policy-snapshot-regressions-r1.log 2>&1
```

The shell then displayed the tail of each completed log without modifying it.
For a new run, use new output paths and record that run's revision and environment.
The coordinator released the heavy slot after these two cohorts; archiving them
did not run tests again.
