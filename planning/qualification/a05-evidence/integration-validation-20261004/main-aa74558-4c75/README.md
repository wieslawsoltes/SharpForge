# Main aa74558 reconciliation cohort at 4c75

The completed 29-file command **failed**: **283 tests, 276 passed, 7 failed,
0 skipped**. The runner reported **66,668.970326 ms**; command wall time was
**66.85826125300082 s**, with exit status **1**. The passing admission and
source-fusion checks do not make the combined command pass.

The exact tested commit was `4c75ea43f5310e50594098076693d1582b49c7d3`, tree
`bdcb5c1429bd01e2992388b5ed95c56303d05e63`. The execution record reports the
same clean identity before and after the command, run in
`/tmp/a05-integration-42f7738360b9` from 2026-10-04T22:23:00.860218+00:00
through 2026-10-04T22:24:07.718745+00:00.

The [original TAP](admission-conversion-fusion-debugger.log) and
[execution JSON](admission-conversion-fusion-debugger-execution.json) are
byte-identical copies from the scratch capture directory. The journal preserves
complete ordered argv, Node v24.19.0, selected SDK10 host/net10.0 settings,
`--expose-gc`, serial TAP execution and one run slot with a 512 MiB V8 heap cap.
[manifest.json](manifest.json) records original paths, sizes, SHA-256 hashes,
and tested source identities for all 29 test files plus the three admission
integration modules. The raw log SHA-256 is
`880f97c320de7f7746793cb324cc495364393204db51f0e42978178ac991ac53`.

## Preserved merge contracts and passing scope

Main `aa74558ccae4851817b23d0a19c5fdfb1ef5a350` separates static CIL admission
from execution budgets and includes local constructor identity/PE bounds work.
The resolution retains its admission helper names and unchanged-options fast
path while preserving A05's separate heap quota and explicit nested
`assemblyLimits`. Initial admission and late callback verification share that
normalizer. A05 managed heap, stack, frame, callback and execution behavior is
retained; no structural maximum is raised.

Both original admission cohorts are retained and passed: A05's
`a05-cil-admission-budget.test.js` is byte-identical to its premerge version,
and main's same-named cohort is byte-identical in
`a05-cil-admission-static-execution.test.js`. The manifest proves both Git blob
identities. New admission-options tests and existing assembly/heap/callback
limit checks also passed.

Source fusion and prepared-call correctness, Int32 handler checks, and ABI32
conversion/native-width **qualification machinery unit tests** passed. This
is evidence for the executed checks; it is not an actual new 32-bit CLR oracle
capture, a complete ABI32 matrix, or a measured source-fusion speedup.

## Seven remaining failures

| TAP test(s) | Scope | Observed failure |
|---|---|---|
| 115 | Source evaluation publication/history | The test reads `suppressed` from a null disabled-scheduler snapshot. Assigned to Snapshots for the oracle repair. |
| 120–124 | CIL evaluation transaction/history cases | `Unverified virtual override; select its method directly`, directly or instead of the expected delivery error. Assigned to Control. |
| 142 | User delegate named `Button` | The direct CIL route faults with the same unverified-target error. Assigned to Control. |

The exact assertions, diagnostics and stacks are retained in the raw log.
No subsequent repair is represented as having passed in this capture. The
previous interrupted full A05 attempt and earlier failed merge cohorts remain
independent historical evidence. No full A05, browser, release-size,
all-platform or performance qualification is claimed. No tests, builds or
measurements were run while preparing this archive; original diagnostic
whitespace is retained.
