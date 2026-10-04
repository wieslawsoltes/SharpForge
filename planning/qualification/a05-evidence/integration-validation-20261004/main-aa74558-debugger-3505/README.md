# Debugger and late CIL admission repair at 3505

The completed focused eight-file run **passed: 89 tests, 89 passed, 0 failed,
0 skipped, 0 cancelled**, exit status **0**. TAP reported **8,736.638346 ms**;
the execution journal measured **8.899706256001082 s** wall time.

The measured revision was `3505b8a50d0f6e860c5a8b8eeebb239830eca6b0`, tree
`290d3cb62d20dbba7347d23550e6b0acb4d6f4ae`. The journal records the same clean
identity before and after execution, with Node **v24.19.0** in
`/tmp/a05-integration-42f7738360b9`, from
`2026-10-04T22:40:06.410911+00:00` through
`2026-10-04T22:40:15.310882+00:00`.

[The original TAP](debugger-delegate-repair-3505.log) and
[execution journal](debugger-delegate-repair-3505-execution.json) are copied
byte-for-byte. The journal retains the exact absolute Node executable, ordered
argv, `scripts/limited.js` wrapper, `--test-concurrency=1`, `--expose-gc`, TAP
reporter, and resource environment: one parallel run, one test worker and
512 MiB maximum old space. The captured parent `NODE_OPTIONS` was null; it
has not been rewritten to imply an explicitly supplied value. All captured
.NET toolchain environment selections were null.

[The manifest](manifest.json) records source paths, byte lengths, SHA-256
digests, measured identity and the Git blob identities of all eight test files.
The raw log SHA-256 is
`9e3bd94fc768b2a7d27c0d4bb4ad60552977a7233704fbfc64e590dd516e7938`.

The passing scope includes all **12** source/CIL evaluation transaction cases,
late verified-call membership and rollback, prepared runtime delegates, local
constructor identity, prepared virtual calls, token caching, and the existing
advanced and ordinary debugger tests. Disabled-scheduler history explicitly
uses its canonical null snapshot, with separate enabled-scheduler coverage.
The transaction checks cover committed history, preview and cancellation,
result roots during host collection, preparation failures, and partial UI or
output publication failures.

The [earlier 29-file cohort](../main-aa74558-4c75/README.md) remains an
independent failed record: **283 tests, 276 passed, 7 failed**. This focused
repair result neither overwrites that record nor qualifies all other tests in
that broader cohort. Counts are not added across these overlapping runs.
There is no full-suite, native CLR, browser, performance or release-size claim.
No tests, builds or benchmarks were run while preparing this archive; original
raw bytes and historical command paths are preserved.
