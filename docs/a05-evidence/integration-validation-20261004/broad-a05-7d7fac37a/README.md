# Broad A05 regression pass at 7d7fac37a — 2026-10-04

The completed broad regression run passed **3,369/3,369 tests**, with zero failed,
skipped, cancelled or TODO tests. Node reported a test duration of
**390,352.526802 ms**. The exact tested revision is
`7d7fac37a672d0961fa82c457b64910c0c97a7d6`, tree
`5a1db2dbc3fcbe948ac46553a73774260c98c8fd`.

The [original journal](broad-a05-final-candidate-journal.json) records Node
`v24.19.0`, an unchanged HEAD and clean working tree before and after execution,
start/end timestamps, successful exit status and the full expanded argument list.
The command used `node scripts/limited.js node --expose-gc --test
--test-concurrency=1 --test-reporter=tap` followed by 315 explicit test paths:
313 top-level `a05-*.test.js` files, `tests/preemption.test.js` and
`tests/conformance/security/limits.test.js`. Resource limits were explicitly
one concurrent run, one test file and a 512-MiB V8 heap cap.

The [raw TAP output](broad-a05-final-candidate.tap) and journal are retained
byte-for-byte. [manifest.json](manifest.json) records their original paths, byte
counts and SHA-256 hashes, the selected-file counts and exact result. Every
journaled test path was verified to exist in the recorded Git revision. The
archive was created only after the run completed; the earlier completed-gates
checkpoint intentionally excluded these then-active files.

This is a broad Node regression selection, not the entire repository's tests or
all qualification commands assigned to A05. In particular, it does not replace
the separate long native numeric replay, independent GC-stress protocol,
prescribed performance/latency/allocation/fairness/snapshot measurements, or the
two complete T12 repeatability runs. Tests of a qualification harness establish
its correctness, not a passing measurement from that harness.

Node Wasm and retained native-fixture replay coverage do not constitute fresh CLR
or browser execution. The newly added heap/GC browser case still needs its own
actual Chromium, Firefox and WebKit runs. Historical published-312 platform
reports remain scoped to their original source and case inventory.

The [earlier failed repair cohorts](../ci-repair-checkpoint/README.md),
[interrupted A00 attempt](../a00-contracts/README.md), and subsequent
[completed A00/static/build gates](../completed-gates/README.md) remain unchanged.
Their overlapping test counts are not added to this run, and this archive does
not close issue acceptance criteria or claim Project 7 completion.
