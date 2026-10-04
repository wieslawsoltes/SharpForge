# Project 16 hosted qualification history

The latest recorded attempt is [a4](#appended-hosted-attempt-a4--original-completed-outcome):
the complete Ubuntu/Chromium scope finished with nine passing and six failing
outcomes. The a1–a3 sections below retain their original evidence cutoff; the
appended a4 section records the later execution and does not change those results.

## Historical a1–a3 evidence cutoff

These are the actual first three hosted attempts, including their failures.
The machine-readable [ledger](project16-hosted-qualification.json) records exact
source identities, artifact hashes, individual outcomes and source-known
corrections. This document closes no issue and claims no later corrected-browser,
standalone-runtime, native, assistive-technology or performance pass.

| Attempt | Hosted run and exact source | Observed result |
|---|---|---|
| a1 | [37171181813](https://github.com/wieslawsoltes/SharpForge/actions/runs/37171181813), `f99fc52e12c3a794b352463286dc0c58ae790521` | Workflow YAML parse failure; **zero jobs and no qualification execution**. The pip command's unquoted `--only-binary=:all:` plain scalar was invalid. |
| a2 | [37171747249](https://github.com/wieslawsoltes/SharpForge/actions/runs/37171747249), `e990e9342678117090a48516ec736d92104be4b2` | Ubuntu/Chromium `all` attempt: **A19 662/662 passed; A20 678 tests, 669 passed, nine skipped, zero failed**. First browser suite failed in the callable/string helper boundary; later suites and performance were not reached. |
| a3 | [37172716850](https://github.com/wieslawsoltes/SharpForge/actions/runs/37172716850), `e4629f443b59bfc2d7494b731be19afc5974b7b1` | Ubuntu/Chromium `browser` attempt: all eight selected functional suites completed, **three passed and five failed**. Node and performance stages were not selected. |

The exact source trees are:

- a1: `8f44869f8f65c8a8072f364e7d1b8fd33dd84e47`.
- a2: `36c33c1974b2429edc1798637673d548c822124d`.
- a3: `1733c01dae0e44cea49dd82a574fda7b8286d6be`.

Both executing attempts passed their static checks, normal builds and standalone
packaging before browser execution. The generated standalone files were
15,146,002 bytes in a2 and 15,215,611 bytes in a3. Neither packaging result is
standalone runtime qualification. The retained browser sessions identify
Playwright-managed **Chromium 153.0.8010.12** over HTTP and record empty CSP
violation arrays; failed behavior remains failed.

The a2 A19 duration was 36,501.413317 ms; A20 was 35,192.636134 ms. These are whole
Node test-run durations, not browser latency measurements. The nine A20 skips
retain their original names and reasons in the ledger and raw log: six explicit
Vim/host capability limits, desktop Vim oracle absence, browser-key/assistive
qualification, and the unavailable pinned Unicode 16.0 native Intl comparison.
None counts as a passing test. No overlapping run counts are added together.

## Actual a3 browser outcomes

The original [qualification summary](evidence/project16-hosted/a3/qualification-summary.json)
is authoritative. The older publication-state snapshot still said `in_progress`;
the ledger preserves that stale snapshot as provenance without using it as the
completed run's status.

| Suite | Result | Observed boundary |
|---|---|---|
| Workbench docking | Passed | Actual docking fixture completed. |
| Workbench shell | Passed | Actual shell fixture completed; its named checks do not certify all assistive behavior. |
| Workbench sessions | Failed | `Workbench event listeners failed` during project membership changes after workspace adoption. |
| Workbench lazy tools | Passed | Static local-asset first-activation fixture completed; no standalone/offline or startup-speedup inference. |
| Workbench workflows | Failed | Project-creation modal did not close before the predicate deadline; later workflow assertions were not reached. |
| Editor insights | Failed | `Show potential fixes` button count assertion; five preceding scenario checks passed within this failed suite. |
| Editor providers | Failed | Comment/string rename preview timed out; one preceding Fix All scenario passed within this failed suite. |
| Editor view | Failed | `window.editor?.dispose is not a function` during fixture setup; zero scenario checks passed. |

The a2 browser failure was earlier and different: the docking caller supplied a
Python function to a helper that expects JavaScript predicate text, producing
`AttributeError: 'function' object has no attribute 'lstrip'`. That failed run is
retained even though a3 subsequently passed docking.

## Publication and source-known corrections

The bounded [publication-facts projection](evidence/project16-hosted/publication-facts.json)
retains the selected original fields and the SHA-256 of its complete source
state. Large commit/blob inventories are omitted. Local and published commit
identities remain distinct where the publication record distinguishes them.

| Merged PR | Recorded core evidence | Interpretation |
|---|---|---|
| [#3843](https://github.com/wieslawsoltes/SharpForge/pull/3843) | [Own core 37170995922 / 111343752758](https://github.com/wieslawsoltes/SharpForge/actions/runs/37170995922/job/111343752758): success; checkout success | Final implementation composition merged as `f99fc52e…`; this core result did not qualify browsers. |
| [#3865](https://github.com/wieslawsoltes/SharpForge/pull/3865) | [Main core 37171692669 / 111345755638](https://github.com/wieslawsoltes/SharpForge/actions/runs/37171692669/job/111345755638): success | YAML correction merged as `e990e934…`; a2 subsequently executed actual jobs. |
| [#3904](https://github.com/wieslawsoltes/SharpForge/pull/3904) | [Own core 37172637371 / 111348584889](https://github.com/wieslawsoltes/SharpForge/actions/runs/37172637371/job/111348584889) and [main core 37172677101 / 111348698282](https://github.com/wieslawsoltes/SharpForge/actions/runs/37172677101/job/111348698282): success | Browser-caller/outcome corrections merged as `e4629f44…`; the resulting a3 browser scope still failed. |

At this evidence cutoff, later correction status is source-known only:

- Editor correction source `7c2eecc34e1629ac05e8f5896845d2e8d2bed54a`
  scopes Quick Info's exact locator, exercises its real action, isolates temporary
  rename previews from background provider requests, and explicitly owns editor,
  model and service instances in the view fixture. Its corrected browser result
  is pending; the five failed a3 suites have not become passing results.
- The session/workflow owner diagnosed old `CodeEditor.saveViewState` disposal
  repopulating the shared DocumentService model map with a removed model. Planned
  cleanup then disposed that model before membership locks encountered it.
  Source correction `24a5ea2ee89cc26cb20425c3137870a2ba264fff` now guards
  ownership/cache reuse and active editor selection. Seven cases in two focused
  test files are authored but unexecuted after correction; runtime/browser
  qualification remains pending.
- Actual Studio 200 MiB File-input driver source
  `66fe0cd3c9f00a8a40bf42532936b10fd1f4569e` is committed; its browser execution
  is pending. It does not replace the existing five-size latency benchmark or
  establish OS file-picker permission behavior.

Later real runs should be appended with their own source identities. They must
not rewrite these historical attempts into successes.

## Preserved evidence and remaining qualification

| Exact downloaded archive | Artifact and size | SHA-256 |
|---|---|---|
| [a2 ZIP](evidence/project16-hosted/a2/p16-hosted-a2.zip) | [11290869652](https://github.com/wieslawsoltes/SharpForge/actions/runs/37171747249/artifacts/11290869652), 74,410 bytes | `08dfddfe17b2d4a02bd03aff172699ad972b6d6f8d371d4cc452e86ff19ac61f` |
| [a3 ZIP](evidence/project16-hosted/a3/p16-hosted-a3.zip) | [11292460593](https://github.com/wieslawsoltes/SharpForge/actions/runs/37172716850/artifacts/11292460593), 3,754,687 bytes | `7fe07d3374bdb1bb1c9c17dc36e730dfa36b39381e40c7b905d40452aeb550ba` |

The original [a1 failure record](evidence/project16-hosted/a1/workflow-parse-failure.json),
[a2 job log](evidence/project16-hosted/a2/job.log),
[a3 job log](evidence/project16-hosted/a3/job.log), source/session/suite JSON and
scenario summaries are copied unchanged. Every archived file has a byte count
and SHA-256 in the ledger. Trace ZIPs and screenshots remain inside the two
original archives, with no second extracted copy committed.

The corrected browser cohort, Windows/macOS and Firefox/WebKit runs, actual
standalone workflows and offline first use, actual large-file ingress and browser
performance measurements remain separate pending outcomes. Branch-triggered
attempts use empty performance baselines, so even a future successful capture
cannot imply a relative regression verdict without a reviewed compatible
comparison. Native file permissions, physical input and cross-application
clipboard, CJK IMEs, screen-reader speech, actual high-contrast use and desktop
or native oracles are not established by these attempts.

This evidence-only archival change ran no tests, builds, static gates, benchmarks
or browsers. It modifies no earlier local qualification history or issue status.


## Appended hosted attempt a4 — original completed outcome

This later observation leaves every a1–a3 outcome and its historical cutoff
above intact. [Run 37175293552](https://github.com/wieslawsoltes/SharpForge/actions/runs/37175293552)
([job 111356550684](https://github.com/wieslawsoltes/SharpForge/actions/runs/37175293552/job/111356550684))
completed the full selected scope on Ubuntu/Chromium 153.0.8010.12 at
`8d1be9cffa04b0fd7390e5cb6fe5f6c03b997557`, tree
`dc9d4e337b91c6e878e7c6c7d65f013667b5ec6b`.
The [original summary](evidence/project16-hosted/a4/qualification-summary.json)
records **15 outcomes: nine passed and six failed**. These are qualification
outcomes, not test counts; no total is added across earlier or overlapping runs.

| Selected outcome | Original result |
|---|---|
| Node A19 | Passed: 710 tests, 710 passed, zero failures or skips. |
| Node A20 | Passed: 686 tests, 677 passed, nine skipped, zero failures. |
| Browser workbench docking | Passed. |
| Browser workbench shell | Passed. |
| Browser workbench sessions | Failed: `Particle.cs` was still resolved by docking after leaving the document workspace. |
| Browser workbench lazy tools | Passed. |
| Browser HTTP workflows | Failed: project creation reported the same unavailable `Particle.cs`. |
| Browser standalone workflows | Failed: actual `file:` navigation timed out waiting for non-null Studio metrics. Later workflow checks were not reached. |
| Browser editor insights | Failed: eight scenario checks passed before the `Find in current file` textbox lookup timed out. |
| Browser editor providers | Passed. |
| Browser editor view | Passed. |
| Performance capture | Passed its absolute assessment; generated-model 200 MiB event-to-paint p95 was approximately 32.3 ms against 50 ms. Relative regression verdict remains absent. |
| Performance editor UI budgets | Failed: incomplete or erroneous capture; combined absolute assessment failed. |
| Performance actual Studio large file | Failed: the driver encountered `Unregistered storage key sharpforge.watch-windows.v1` during the import wait. No successful 200 MiB ingress is established. |
| Performance instrumentation | Passed the specified aggregate gate: approximately 0.1964165% overhead, below 1%, across 12 alternating pairs. |

The [editor assessment](evidence/project16-hosted/a4/editor-assessment.json)
measures input/keydown/scroll events through two animation-frame callbacks on a
generated model. It is distinct from the failed real Studio File/Blob ingress
case. Both configured baseline paths were empty, so capture success does not
establish a relative regression result.
The [instrumentation report](evidence/project16-hosted/a4/instrumentation-overhead.json)
retains all samples and source/served-artifact identity. Its gate compares sums
of the same measured workload: enabled 25,047.0 ms, disabled 24,997.9 ms,
difference 49.1 ms. This bounded shared-host observation does not establish
statistical certainty or qualification on other platforms.

The [large-file report](evidence/project16-hosted/a4/a20-studio-large-file-results.json)
retains the actual 209,715,200-byte synthetic input, expected source counts and
failure. Read-only diagnosis located the unregistered key in Watch initialization
before import: Studio surfaced its rejected storage read as an error toast,
which the driver subsequently observed. The separate source correction
`2f1d498c5c94a482a5a37f07691d1af4a1ec5cad` registers that existing v1 key and adds
four production-storage/loader regression cases. Those cases are unexecuted at
this cutoff, and the 200 MiB driver remains unchanged. The original failure is
not rewritten as a pass.

The exact [downloaded ZIP](evidence/project16-hosted/a4/p16-hosted-a4.zip)
([artifact 11293386531](https://github.com/wieslawsoltes/SharpForge/actions/runs/37175293552/artifacts/11293386531))
is **8,862,070 bytes**, SHA-256
`f07f9ef776d60f070e8ac9614bc65233e77a75215fce3559f8cc02acf8a680c3`.
The [job log](evidence/project16-hosted/a4/job.log), source, session, suite, scenario
and performance JSON reports are archived unchanged with byte counts and hashes
in the ledger. Screenshots and trace ZIPs stay inside the original archive;
no duplicate extracted traces or screenshots are committed.

The six failed outcomes remain pending corrected execution. Cross-platform and
cross-engine coverage, native permissions, physical input/clipboard, IME,
assistive behavior and external oracles remain separate obligations. Archiving
a4 executed no tests, builds, gates, benchmarks or browsers and closed no issues.
