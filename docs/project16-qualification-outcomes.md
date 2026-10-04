# Serial qualification outcomes

`scripts/project16-qualification.js` treats A19, A20, each selected browser suite,
and the performance pipeline as independent scopes. A failed scope is recorded
and the next starts only after it settles. The aggregate exit code is one if any
scope failed, otherwise zero. Performance's dependent captures and baseline
preflight remain fail-fast within that pipeline; invalid stage/browser setup or
an unwritable report still terminates the runner.

`qualification-summary.json` in `SHARPFORGE_RESULTS_DIR` records schema version,
source/tree and workflow identity when supplied, stage/browser selection, exact
commands, timestamps, statuses, exit codes and original failure messages. It is
checkpointed before and after scopes. Intermediate checkpoints retain `running`
and `pending` entries instead of claiming completion. Capture-only performance
assessment retains a null regression verdict even when its scope succeeds.

`qualify(options)` injects scope/performance runners, report writer, clock and
environment for deterministic orchestration tests. Runners reject on failure;
its returned `exitCode` is applied by the CLI. The five focused regressions in
`tests/a19-qualification-outcomes.test.js` are authored; execution is pending the
complete correction cohort. No browser, build or performance pass is inferred.
