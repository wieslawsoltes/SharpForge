# A05 serial validation queue

Implementation may proceed concurrently in separate worktrees. Root owns one
validation queue for Project 7. Helpers prepare regression coverage and evidence
harnesses without executing them. Every validation process must exit before the
next starts, including builds, native oracles, browser runs and benchmarks.

Qualify complete epics or assembled scopes. Repair failures in coherent batches,
then run the affected coverage once. Do not repeat passing checks unless a later
change affects their result. Projects 6 and 9 remain owned by their agents.

| Order | Scope | Entry condition | Work |
| --- | --- | --- | --- |
| 1 | E01 repairs | Complete execution scope assembled | Focused regressions for recorded qualification failures |
| 2 | E01 Node | Repair batch complete | A05 execution suite; large numeric differential and GC stress jobs run individually |
| 3 | E01 integration | Node failures resolved | Syntax, core and package checks required for the PR, sequentially |
| 4 | E01 native | Relevant fixes assembled | Missing or invalidated .NET oracle comparisons only |
| 5 | E01 browser | Final bundle prepared in its own queue slot | Browser qualification against that exact bundle and commit |
| 6 | E02 correctness | T07–T12 integrated with qualified E01 changes | Interpreter, typed slots, pooling, profiling, Wasm and performance-gate correctness |
| 7 | E02 performance | Correctness passed on the measured revision | Baseline and candidate measurements on the same idle runner, one after another |

Use Node 24 with `NODE_OPTIONS=--max-old-space-size=512` and
`node --test --test-concurrency=1`. Select one browser and one native runner at a
time. Stream large differential output instead of retaining every VM's output.
If a job exceeds its memory limit, repair or partition the harness before retrying.

Record the tested commit, exact command, exit status, counts and log or report
path. A queued job is not validation evidence. Preserve failing measurements;
never replace missing performance baselines with estimates. After required PR
checks pass, merge the completed scope and retain any broader qualification still
pending as explicit follow-up work.
