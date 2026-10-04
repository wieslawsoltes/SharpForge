# Completed supplement at 31ce

This 17-file supplement **failed**: 781 tests, **779 passed, 2 failed, 0 skipped**.
The test runner reported 67,001.154921 ms; measured command wall time was
67.17545465800504 s. Exit status was 1. The selected prior async/interface/layout
and parity failures no longer failed, but the two debugger cases below prevent
an aggregate pass claim.

The tested commit was `31ce9e74482310f26efd8ee582931dc93b32f924`, tree
`ce145ed06ecfb80590f14699254f4b4451b80cd8`. The original execution record reports
the same clean identity at command start and end. It preserves complete ordered
argv, UTC timestamps, resource settings and toolchain environment. The command
used Node v24.19.0 through the limiter, one run slot, serial tests, 512 MiB V8
heap, `--expose-gc`, TAP, and the selected SDK10 host/net10.0 framework.

- Test 253: source evaluation rollback restores target state, output and history.
- Test 266: CIL evaluation rollback restores target state, output and history.

Both failed in `tests/debugger-advanced.test.js:28:2` with
`InvalidOperationException: Cannot snapshot during an active platform transaction`.
The stacks reach `snapshotPlatformState` through `remember` during
`evaluateFunction`. The raw failures remain intact; a later repair does not
retroactively change this result.

[Raw TAP](dispatch-parity-debugger-supplement.log) and the
[original execution JSON](dispatch-parity-debugger-supplement-execution.json)
are byte-identical copies from the scratch capture directory.
[manifest.json](manifest.json) records sizes, SHA-256 hashes, original paths
and exact Git blob/SHA-256 proof for all 17 selected test files.

This is supplemental evidence, not a completed full A05 run. The
[preceding full-manifest attempt](../main41eb-full-a05-incomplete-001a/README.md)
remains interrupted without an observed exit code or final summary.
No full-asset build, release-size, browser, all-platform or performance pass
is claimed. No tests, builds or checks were rerun while creating this archive;
original diagnostic whitespace is retained.
