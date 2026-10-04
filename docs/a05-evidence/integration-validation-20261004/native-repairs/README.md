# Native repair integration validation — 2026-10-04

This additive archive preserves 13 root validation outputs byte-for-byte. The
[manifest](manifest.json) records their SHA256 hashes, byte lengths, full tested
revisions and trees, commands, wrapper and resource environment. The
[original journal](journal.original.json) is unchanged; the [completed journal](journal.json)
updates the formerly pending `3fd119f21` result to the coordinator-confirmed
117 tests, 107 passed and 10 failed, matching the retained log.

| Revision | Run | Result |
| --- | --- | --- |
| `5cd5b1d05` | [First native repairs](a05-native-repairs-first-5cd5b1d05.log) | 72 Node tests: 70 passed, 2 failed |
| `b9bedea32` | [Native/browser adjacent regressions](a05-native-browser-adjacent-b9bedea32.log) | 195 Node tests passed |
| `b9bedea32` | [Browser fixture contracts](a05-browser-contracts-b9bedea32.log) | 5 Python tests passed |
| `b9bedea32` | [Original launch/matrix invocation](a05-browser-launch-matrix-b9bedea32.log) | 6 tests passed; matrix module import error, command failed |
| `b9bedea32` | [Initial static gate](a05-npm-check-b9bedea32.log) | Failed static-import gate; manifests and 4609-module syntax check passed |
| `b9bedea32` | [Full Python browser infrastructure discovery](a05-browser-python-discover-b9bedea32.log) | 10 tests passed; 2 module import errors, command failed |
| `b9bedea32` | [Corrected matrix discovery invocation](a05-browser-python-matrix-b9bedea32.log) | 4 Python tests passed |
| `b9bedea32` | [Supplemental retained nullable/decimal DLL replay](a05-native-nullable-decimal-b9bedea32.json) | 4 cases passed: 2 retained SDK 8 DLLs at ABI32 and ABI64 |
| `25a771ed3` | [Managed state-machine layout integration](a05-native-async-layout-25a771ed3.log) | 103 Node tests: 101 passed, 2 failed |
| `e8b04b03a` | [Repaired static gate](a05-npm-check-core-repairs-r2.log) | Passed; 4615-module syntax check and static imports |
| `3fd119f21` | [First-chance policy integration](a05-first-chance-integrated-3fd119f21.log) | 117 Node tests: 107 passed, 10 failed |
| `abc0b1f0f` | [Earlier main-197 harness selection](a05-main197-harness-focused-r1.log) | 18 Node tests passed; three nonexistent input paths did not execute |
| `abc0b1f0f` | [Earlier main-197 admission selection](a05-main197-admission-focused-r1.log) | 65 Node tests passed |

These cohorts overlap. Their counts must not be added, and a later passing
selection does not change an earlier failure. Node totals contain no skips or
cancellations. Python module import errors remain errors, not passes or skips.
The manifest separates Node test counts, Python errors, static checks and
supplemental replay cases.

The first native-repair run exposed actual Roslyn state-machine auto-layout
storage rejection and a box-lifetime regression. The subsequent layout cohort
completed the retained actual SDK 8 async/iterator replay but failed two new
managed interior-address cases. The first-chance integration run still failed
nine snapshot cases reporting captured-reference ownership errors and one
standalone memory replay because its `native.json` input was absent. Follow-up
diagnosis traced the snapshot errors to stale weak string-intern entries; its
repair is separate from this run. Those diagnostics are retained without
claiming that later repairs passed in this run.

The original Python launch/matrix command omitted the browser-script import
directory. The corrected matrix discovery command passed four tests. A separate
broader discovery command failed to import two modules because local Python had
no Playwright installation. Its ten passing tests do not establish real browser
execution. The initial npm gate similarly retains both genuine static-import
issues and sparse-checkout planning-file issues; the later gate passed on its
own recorded revision.

The `abc0b1f0f` harness command named seven files, but only four existed and 18
tests ran. Node 24's successful exit did not prove execution of the nonexistent
`a05-varargs-unsupported.test.js`, `a05-delegate-protocol.test.js`, or
`a05-native-plan.test.js`. The separate admission cohort provides its own
explicit file selection and 65-test result.

The nullable/decimal JSON compares retained SDK 8 binaries with their captured
native stdout and exit codes at both native integer widths. It retains assembly
hashes and the tested revision, but the original ad-hoc stdin program was not
saved as a standalone runner. It is supplemental evidence, not a fresh CLR run
or a substitute for reproducible native CI qualification.

The coordinator recorded each command with `node scripts/limited.js` and
`SHARPFORGE_MAX_PARALLEL_RUNS=1`, `SHARPFORGE_TEST_CONCURRENCY=1`,
`SHARPFORGE_MAX_OLD_SPACE_MB=512`. Full revision/tree identifiers and argv are
retained as supplied; logs do not independently prove a clean checkout or exact
Node/V8 environment. These are validation records, not T12 benchmark evidence.
The separately archived actual CI and byref/numeric evidence is not duplicated
here. Generated logs preserve all original whitespace.

The [final repair checkpoint](final/README.md) adds the later passing 3320-test
A05 selection, focused checks, fresh byref corpus, static gates and the retained
build-cycle failure. Each result remains attached to its own measured revision.
