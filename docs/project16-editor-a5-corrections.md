# Hosted a5 editor budget proof correction

Work-ID: **SF-A19-T23**. This correction starts from the exact source used by hosted attempt a5,
`c13aa0fd9d27df28b3708bb83d914a04c20a5c7c` (run `37178840757`). It changes the browser evidence contract and its focused
regressions. It does not modify the Code Definition controller, compiler, editor, overview renderer or product workspace.

## Observed failure

The original `editor-ui-budgets.json` reports `captureStatus: completed`, with all 54 Code Definition samples, both caret
boundary observations and all 105 overview samples. Both browser stages completed; page-error and CSP collections are empty.
The aggregate assessment nevertheless failed with `Missing actual workspace or definition boundary checks`.

The driver called `shell.documents.list().length` and labeled that value `workspaceRecords`. It captured **3**, correctly
counting `Alpha.cs`, `Beta.cs` and `Calls.cs`. The validator required **4**, incorrectly treating `Budget.csproj` as another
source editor document. The source-document service and complete workspace record collection have different roles.
The prior synthetic format fixture encoded the same incorrect count, so it did not expose that mismatch.

## Complete correction

The browser setup now captures and checks the actual public data sources separately before timing visits:

- `sharpforge.getWorkspace()` supplies the exact four workspace paths and contents, including the project XML.
- `shell.documents.list()` supplies the three source documents, each with its version and actual `projectsFor(uri)` membership.
- `shell.projects()` supplies the registered project identity; the caller's current project must match it.

The validator requires this versioned workspace proof. Changing an integer from four to three is insufficient. It rejects
missing, duplicate or extra records; different source/project contents; a project file counted as an editor document;
missing or incorrect project registration/membership; and inconsistent caller/source versions. Source definition targets
must match the loaded workspace contents.

Both boundary flags remain required. Their two raw observations must independently prove that neutral whitespace clears the
actual definition text/selection and that rapid caret movement ends on the exact latest source definition. The validator
checks observation identity, offset, source version, read-only/visible state, focus events, selected symbol and browser timing
consistency. Flags without those observations fail. The existing **300 ms** limit now explicitly covers those retained
boundary observations as well as every first, warmup and measured definition visit. The overview limit remains **16 ms**.

The driver includes boundary observations in its per-stage numeric diagnostic precheck, so an over-budget boundary also
retains the launcher's failure trace/screenshots. Raw samples and summaries remain unchanged in shape and are never replaced
with passing synthetic data. The two stages still use separate serial browser sessions.

## Recorded a5 timings remain observations

The failed a5 artifact is retained as originally emitted; this change does not retroactively qualify it. Its measured
Code Definition p50/p95 values were 154.9/166.3 ms for Alpha, 155.4/156.5 ms for Beta and 154.1/166.8 ms for framework metadata.
The largest of all 54 definition samples was 166.8 ms. Neutral/latest boundary durations were 152.6/164.9 ms. The largest of
all 105 overview samples was 2.0 ms. These numbers describe that capture only; the old artifact lacks the new explicit
workspace proof and retains its failed aggregate assessment.

Environment: managed headless Chromium `153.0.8010.12`, Linux `6.17.0-1022-azure`, x86_64, 1440 × 1000 viewport, scale factor 1,
four reported hardware threads. The capture does not certify a physical frame rate, Safari, native platforms or a relative
performance regression result.

## Source verification and pending execution

`tests/a19-code-definition-budget-proof.test.js` reproduces the three-source/four-record distinction and rejects incomplete or
misleading proof. Existing `tests/a19-a20-browser-budget-trace.test.js` now uses the correct proof shape and adds an explicit
over-300-ms boundary rejection. These Node fixtures are synthetic evidence-format tests, not browser performance observations.

No tests, builds or browser measurements were executed while authoring this correction. The integration owner schedules
the complete affected cohort and a later actual browser capture using the unchanged production HTTP/CSP harness.
