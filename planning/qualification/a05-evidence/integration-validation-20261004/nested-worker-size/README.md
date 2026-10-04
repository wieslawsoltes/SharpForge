# Nested-worker size inventory regression

The single focused run passed **4 tests, with 0 failures, skips, or cancellations**, at clean commit
`a3652c85aa6c0f1d4e697ec7efc6ff02f71fc4bd`, tree `24b5ef0324a8cac3d98942ef2a5537692fb2e991`.
The implementation was later integrated as `54387b7c278991aa2c23acd5b0c3893a935e8e5c`.
The three changed measurement/test files have identical Git blobs and SHA-256 digests at those two commits;
this does not assert equality of their entire repository trees.

The tests verify declared nested worker paths despite same-name root decoys, the historical measurement CLI,
rejection when a declared nested file is absent, and unchanged missing-budget and over-limit behavior.
The temporary fixture's dist total is 343 bytes: 325 bytes of declared workers and 18 bytes of root decoys.
Both nested worker readers select the declared files instead of those decoys.

[focused.log](focused.log) and [journal.json](journal.json) are byte-identical copies of the original capture.
The log is the **Node default spec reporter**, not TAP: the executed command did not select a TAP reporter,
and no output conversion or rerun was performed. The journal records the exact absolute Node executable,
argv, working directory, start/end timestamps, resource controls, clean before/after status, and source hashes.
[manifest.json](manifest.json) adds the copied-file digests, result summary, and tested/integrated Git blob proof.

The run used Node `v24.19.0`, one machine-wide run slot, one test file at a time, and a 512 MiB V8 heap cap.
`CI` was unset. The Node runner reported 319.978735 ms; the complete limited command took
0.46734303799894406 seconds. A readable equivalent of the exact recorded argv is:

```sh
SHARPFORGE_TEST_CONCURRENCY=1 \
SHARPFORGE_MAX_PARALLEL_RUNS=1 \
SHARPFORGE_MAX_OLD_SPACE_MB=512 \
NODE_OPTIONS=--max-old-space-size=512 \
node scripts/limited.js node --test --test-concurrency=1 tests/a29-nested-worker-sizes.test.js
```

Only the focused measurement-inventory tests ran. No production build, standalone generation, worker bundle
measurement, package packing, before/after size comparison, or merged async/runtime qualification is claimed.
The historical size ceilings and rejection of unbudgeted identities remain unchanged. This evidence also
does not claim the separately pinned Node/npm reproducible-release toolchain qualification.
