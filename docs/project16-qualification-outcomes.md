# Serial qualification outcomes

`scripts/project16-qualification.js` treats A19, A20, each selected browser suite,
and five performance captures as independent scopes. A failed scope is recorded
and the next starts only after it settles. The aggregate exit code is one if any
scope failed, otherwise zero. Performance's dependent captures and baseline
preflight remain fail-fast within that pipeline; invalid stage/browser setup or
an unwritable report still terminates the runner.

The complete selection contains 16 outcomes: two Node areas, nine functional
browser suites (including real offline `file://` standalone workflows), and
five performance scopes. The original editor/model/memory/workbench pipeline
remains one outcome. Actual Code Definition and overview-canvas measurements,
200 MiB Studio File ingress, paired instrumentation overhead, and initial script
evaluation each run as a separate outcome, even if the earlier pipeline failed. These five scopes run
serially; none is started by ordinary PR or main core checks.

Browser commands retain a 1,320-second outer deadline around the existing
1,200-second browser runner and its diagnostic cleanup allowance. The paired
instrumentation and lazy-evaluation commands each have a 1,200-second outer deadline
and their own bounded 15-minute capture protocol. Lazy evaluation additionally
caps each fresh Chromium process at 60 seconds and compares the shipped lazy graph
with an explicitly labeled same-source eager-entry counterfactual. It preserves
every signed pair and reports unsupported engines as failed evidence, without
substituting Chromium for a requested Firefox or WebKit run. The functional
`browser` stage does not select this Chromium-only performance scope.
Measurement drivers preserve raw and partial
captures; registering a scope does not establish its acceptance result.

`qualification-summary.json` in `SHARPFORGE_RESULTS_DIR` records schema version,
source/tree and workflow identity when supplied, stage/browser selection, exact
commands, timestamps, statuses, exit codes and original failure messages. It is
checkpointed before and after scopes. Intermediate checkpoints retain `running`
and `pending` entries instead of claiming completion. Capture-only performance
assessment retains a null regression verdict even when its scope succeeds.

`qualify(options)` injects scope/performance runners, report writer, clock and
environment for deterministic orchestration tests. Runners reject on failure;
its returned `exitCode` is applied by the CLI. The six focused regressions in
`tests/a19-qualification-outcomes.test.js` are authored; execution is pending the
complete correction cohort. No browser, build or performance pass is inferred.
