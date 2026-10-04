# Task fault unwind integration — 2026-10-04

This retained 13-file cohort finished with **155 passed, 2 failed, 0 skipped**
out of 157 tests. Its exit code is 1; this is not an overall passing run.
All eight new task-fault boundary regressions and both previously failing
compiler async output cases passed, as did the adjacent EH, stack-budget,
registration-lifetime and ordinary-return cases in this invocation.

The exact source was clean commit `867fc2493620de9c375f6f01bc6b3506f70f6168`,
tree `2b7535d9daf5bd7653372bf633cfd50821929868`, before and after execution.
The task boundary implementation was integrated as `3fac` from
`7bf5155a9`. The command, resource limits, Node version, environment, UTC
timestamps and source identity are retained verbatim in
[the execution record](task-unwind-integration-execution.json).
[The complete TAP log](task-unwind-integration.log) is retained without edits;
its SHA-256 is
`3432bd922bebe233fc72d9cb2b6c94e20a95463200a8f91f2e51599667cba300`.

The two failures are in `tests/debugger.test.js`:

- Line 24, object children: `undefined !== '2'`. Follow-up diagnosis identified
  `TypedArray.map` coercing debugger child descriptor objects into numeric
  elements. The debugger adapter repair belongs to a later revision.
- Line 28, reverse snapshots: the whole-heap-zero assertion observed one live
  object. A separate executed trace established that the test's `N` object was
  collected; the remaining 32-byte entry `string[]` argument was a valid root
  while execution was paused. The follow-up test checks that specific object,
  the entry baseline and reverse restoration. This observation does not show
  a compiler leak or terminal-frame retention.

Those later diagnoses explain follow-up work; they do not change either failure
or the 155/157 result captured here. The new regressions cover source and CIL
filter ordering, awaited cleanup, pending task state, GC, local and portable
snapshot replay, chained faults, debugger resume, and preserved process/thread,
suppressed-callback and fatal-fault inspection. No performance claim follows
from this correctness run.
