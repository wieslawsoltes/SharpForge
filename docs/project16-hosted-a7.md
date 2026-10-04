# Project16 hosted attempt a7 — performance failure retained

Work-ID: **SF-A20-T12**. This evidence-only record preserves the original a7 execution and its exact artifacts.

**A7 failed: four of five selected performance scopes passed.** Editor and workbench absolute/comparative checks passed,
as did Code Definition/overview budgets, the actual Studio large-file workflow and the instrumentation aggregate.
The strict lazy-evaluation aggregate failed. That failure has not been relabeled, waived or replaced by a retry.
This record does not declare Project16 complete or change any earlier result.

The [machine-readable ledger](project16-hosted-a7.json) maps all five scopes to original evidence and inventories every
archived byte count and SHA-256. The [original summary](evidence/project16-hosted/a7/qualification-summary.json),
[source envelope](evidence/project16-hosted/a7/source.json) and [job log](evidence/project16-hosted/a7/job.log) remain unchanged.

## Exact execution and selection

| Field | Recorded value |
|---|---|
| Workflow | [Run 37186353254][run], attempt 1; [job 111388977941][job] |
| GitHub result | `completed` / `failure` |
| Source commit | `b8d68d417c792156dedb2ac2b98acf33cac3f141` |
| Source tree | `74021421e044947908f037bf34d00bcb258e25fc` |
| Trigger | Branch creation; nonce `compare-a5-20261004-a7` |
| Branch | `codex/project16/qualify-ubuntu-chromium-performance-compare-a5-20261004-a7` |
| Selection | `performance`, `ubuntu-latest`, `chromium` |
| Capture mode | `captureOnly: false`; reviewed baseline profile `a5` |
| Run created / updated | `2026-10-04T07:37:30Z` / `2026-10-04T07:48:04Z` |
| Scope execution | `2026-10-04T07:38:52.098Z` → `2026-10-04T07:47:57.627Z` |

The exact [run](evidence/project16-hosted/a7/github-run.json), [jobs](evidence/project16-hosted/a7/github-jobs.json) and
[artifacts](evidence/project16-hosted/a7/github-artifacts.json) API tool-response snapshots are preserved separately from
the 22 artifact members. They retain the supplied decoded JSON bytes, not claimed raw HTTP wire bytes.

This attempt selected **only the five performance scopes**. Its browser-backed captures do not constitute a new execution
of the A19/A20 Node-area phases or the nine browser acceptance scopes at this source. The earlier
[a6](project16-hosted-a6.md) and [Windows/Firefox and macOS/WebKit](project16-cross-platform-browser.md) records retain their
own source identities and outcomes; their counts are not added to a7.

## Comparative inputs and original scope verdicts

The profile in [project16-baseline-profiles.js](../scripts/project16-baseline-profiles.js) still pins a5 source
`c13aa0fd9d27df28b3708bb83d914a04c20a5c7c`, tree `29023ed8b962b6d91671bdb0c0359d905ef2659e`, run `37178840757`.
The exact baseline byte counts and hashes are recorded in the JSON ledger. The profile's completed editor and workbench
captures are comparative inputs; **a5's overall result remains failed**.

| Scope | Comparison or acceptance contract | A7 outcome |
|---|---|---|
| `performance` | Editor and workbench compared with pinned a5; existing absolute checks | Passed |
| `performance:editor-budgets` | Code Definition <300 ms; overview render/readback <16 ms | Passed |
| `performance:studio-large-file` | Actual Studio 200 MiB file-input, model, view, edit/undo and disposal correctness | Passed |
| `performance:instrumentation` | Current-run enabled/disabled paired workload sums; aggregate <1% | Passed |
| `performance:lazy-evaluation` | Current-run eager aggregate `ScriptDuration` strictly greater than lazy | **Failed** |

The baseline profile applies to editor and workbench comparisons. It does not convert the other three measurement
protocols or the large-file functional case into comparisons against a5. Each original report retains its own contract.

## Strict lazy-evaluation failure

The [lazy-evaluation report](evidence/project16-hosted/a7/lazy-evaluation.json) completed capture and records `passed: false`.
It preserves 12 alternating pairs across **24 fresh browser processes/profiles**, using the recorded `threadTicks` time
domain, without warmups or retries. Its gate requires the eager aggregate `ScriptDuration` to exceed the lazy aggregate.

| Recorded aggregate | Milliseconds |
|---|---:|
| Eager | 1560.778 |
| Lazy | 1569.770 |
| Eager minus lazy | **−8.992** |

The report's reduction is **−0.576123%**. Five pairs were positive, seven negative and none zero. All pairs are retained:

| Pair | Eager, ms | Lazy, ms | Eager minus lazy, ms |
|---:|---:|---:|---:|
| 0 | 134.219 | 130.864 | 3.355 |
| 1 | 125.888 | 126.328 | −0.440 |
| 2 | 128.497 | 132.946 | −4.449 |
| 3 | 129.462 | 130.769 | −1.307 |
| 4 | 130.573 | 128.535 | 2.038 |
| 5 | 129.992 | 136.896 | −6.904 |
| 6 | 127.933 | 128.310 | −0.377 |
| 7 | 135.421 | 130.836 | 4.585 |
| 8 | 135.774 | 132.030 | 3.744 |
| 9 | 128.030 | 127.097 | 0.933 |
| 10 | 127.148 | 128.135 | −0.987 |
| 11 | 127.841 | 137.024 | −9.183 |

Values in this table are rounded for reading; the original report and ledger retain full precision. The capture does not
establish a cause. No noise explanation, stable product regression, harness defect or performance exception is inferred.
The recorded gate returned false and the scope returned exit code 1; the overall qualification remains failed.

This is the current-run eager/lazy protocol, not a measurement of historical startup, worker CPU, paint, physical frame
rate or wall-startup speedup. Earlier positive lazy observations remain in their original archives and do not override a7.

Independent source and artifact review found no concrete loader or harness defect requiring a correction. All 24 captures
reached readiness, completed and retained no recorded errors. The 12 lazy entry graphs excluded the five controller
modules; all 12 eager entry graphs included `designer-tools.js`, `assembly-workbench.js`, `disassembly-tool.js`,
`msbuild-tools.js` and `project-wizard.js`. Entry-request counts were 1072 lazy and 1086 eager. The common Studio dependency
graph is present in both variants; that limits their work difference without establishing the cause of the signed result.

The exact lazy harness digest is unchanged across a5, a6 and a7:
`57ed5a9f284e5f98e892c905207592ffc5b5600da23b5cb59dae52fbded772c6`.
The raw report retains its file inventory, overlays, marker/readiness checks and entry graphs; the
[protocol](../scripts/workbench-lazy-evaluation/protocol.js),
[capture](../scripts/workbench-lazy-evaluation/capture.js) and
[assessment](../scripts/workbench-lazy-evaluation/assessment.js) define the recorded boundary. This evidence does not
establish a saving for a7. The integration owner retained the failure and directed no extra retry or gate change.

## Editor and workbench comparisons

The [editor assessment](evidence/project16-hosted/a7/editor-assessment.json) passed all **25 relative rows** at the unchanged
20% p95 limit. The [raw browser report](evidence/project16-hosted/a7/editor-browser.json) retains **500 measured samples**,
20 per row after three warmups, with correctness passing and no reported environment changes. Its separate **200 MiB
typing absolute result passed: p95 32.3 ms <50 ms**.

For the three sizes whose undo comparisons failed in a6, these are the distinct a7 observations against the same pinned a5:

| Undo size | a5 p95, ms | a7 p95, ms | 20% limit, ms |
|---|---:|---:|---:|
| 1 MiB | 36.5 | 34.6 | 43.8 |
| 10 MiB | 29.3 | 33.8 | 35.16 |
| 100 MiB | 41.8 | 33.8 | 50.16 |

The a6 failures remain failed in their original report. Passing a7's 20% gate does not assert that every operation stayed
within a 5% change. The separate integration-owner review below records all five measurements above that review threshold.

The [workbench trace](evidence/project16-hosted/a7/workbench-large-trace.json) passed both absolute and relative checks.
It retains 126 raw samples over three fresh-context rounds with 501 C# source files:

| Operation | Samples | a5 p95, ms | a7 p95, ms | 20% relative limit, ms |
|---|---:|---:|---:|---:|
| Cold application startup | 3 | 2633.4 | 2597.1 | 3160.08 |
| Workspace startup | 3 | 2651.6 | 2163.4 | 3181.92 |
| Document switch | 60 | 147.3 | 134.6 | 176.76 |
| Tool activation | 60 | 56.9 | 50.5 | 68.28 |

The [20-row Node model capture](evidence/project16-hosted/a7/editor-model.json) and
[four-size retained-memory capture](evidence/project16-hosted/a7/editor-memory.json) also completed with their recorded
correctness and memory budgets passing. These Node captures do not measure browser paint, browser DOM memory or total
allocation counts.

### Explicit integration-owner review and sign-off

CONTRIBUTING requires explicit review of measurements over 5%, separately from the configured 20% p95 gate. Independent
raw-data review and the integration owner's recomputation identified exactly five such metrics across four editor rows:

| Measurement | a5, ms | a7, ms | Additional time, ms | Observed increase |
|---|---:|---:|---:|---:|
| 1 KiB paste p95 | 49.5 | 52.8 | 3.3 | 6.6667% |
| 10 MiB typing p95 | 32.3 | 34.4 | 2.1 | 6.5015% |
| 10 MiB undo median | 28.6 | 30.3 | 1.7 | 5.9441% |
| 10 MiB undo p95 | 29.3 | 33.8 | 4.5 | 15.3584% |
| 100 MiB undo median | 28.8 | 31.1 | 2.3 | 7.9861% |

No workbench median or p95 exceeds 5%. The JSON ledger retains each metric's full-precision values and deltas.

**Signed role: root integration owner (`/root`), recorded 2026-10-04 and in [PR #4453][review].** The decision is to retain
the completed ChangeTracking correctness fix and accept these disclosed observed editor tradeoffs. Removing the fix
restores seven demonstrated deletion/CRLF/stale-marker failures and 2,622 retained overview candidates instead of one.
The complete affected cohort passed 69/69 with the fix, as documented in the
[prior local qualification](project16-final-followup-local.md) and its
[raw manifest](evidence/project16-final-followup-local/manifest.json). Those correctness tests were not rerun in a7.

The accepted additional times are 1.7–4.5 ms for the listed metrics. This review does not claim that the fix caused those
differences or dismiss them as shared-host noise: broader upstream source changed between captures. It is an explicit
acceptance of disclosed observations, **not an overall 5% benchmark pass**, and does not waive a6, a7 lazy evaluation,
m1 or any native/manual qualification requirement. No human approval is asserted by this integration-owner record.

## Other independent results and their limits

- **Code Definition/overview:** the [UI report](evidence/project16-hosted/a7/editor-ui-budgets.json) retained 54 definition
  observations and two neutral/latest-caret boundary observations, with maximum 167.6 ms against 300 ms. The exact
  workspace/source/project ownership and observed DOM boundary proof are present. The overview retained 105
  observations over 10,000 lines at three widths; maximum render-plus-pixel-readback duration was 1.8 ms against 16 ms.
  `renderMs` and following-RAF cadence remain distinct fields. This report has no comparative verdict or physical
  frame-rate/Safari certification.
- **Studio large file:** the [functional capture](evidence/project16-hosted/a7/a20-studio-large-file-results.json) passed
  actual 200 MiB `File`/`Blob` ingress through the real Studio file-input handler, retained sibling documents, bounded
  viewports, shared-model edit/undo and disposal. Observed open time was 6868.9 ms; this functional case does not claim
  an open-latency budget, OS file-picker permission or physical disk-throughput result.
- **Instrumentation:** the [24 captures](evidence/project16-hosted/a7/instrumentation-overhead.json) retain 3168 raw
  operation samples in 12 enabled/disabled pairs. The fixed aggregate gate passed: 24,958.2 ms enabled versus
  24,881.3 ms disabled, **+0.309067% <1%**. The aggregate does not establish a bound for every operation: document-switch
  totals increased 1.2956% and command totals increased 19.1327%; one pair increased 1.8682%. All diagnostic rows and
  pairs remain visible. This is a bounded observation, not statistical proof or a general speedup claim.

The four archived browser session reports belong to workbench performance, the separate definition and overview stages,
and Studio large-file performance. Each reports success with zero CSP violations and zero session diagnostic errors;
these reports are not the nine browser acceptance scopes.

## Environment and qualification boundary

The recorded environment is Playwright-managed headless **Chromium 153.0.8010.12**, Linux 6.17.0-1022-azure, x86-64.
The Node benchmarks report Node 24.21.0, V8 13.6.233.17-node.53, AMD EPYC 7763 and four logical CPUs. The production UI
captures use a 1440 × 1000 viewport at device scale 1. Every original report retains its own process, serving and timing
protocol, including fresh-process lazy pairs versus shared-process instrumentation contexts.

Browser event-to-two-RAF measurements include scheduling and are not physical input-to-display latency. Actual IME,
screen readers, native desktop/Visual Studio oracles, OS clipboard grants, physical frame rate, Safari and other OS/engine
pairings are not certified here. Subsequent fixes or observations need their own source identities and results; they
cannot turn this a7 failure or earlier failures into passes.

## Byte-exact archive and preparation

| Archived original | Bytes | SHA-256 |
|---|---:|---|
| `p16-hosted-a7.zip` | 1,454,102 | `92a4ff4c16e00ac4ab7c02fb06a788ae1d5ded631d4c7554e22f47777ffb3ec0` |
| `job.log` | 97,927 | `37e3cb5a6752b97a4c1bc18be6f19f632c7b4625c799e3dfd141756878eea598` |

The [original ZIP](evidence/project16-hosted/a7/p16-hosted-a7.zip) matches
[artifact 11297890150](https://github.com/wieslawsoltes/SharpForge/actions/runs/37186353254/artifacts/11297890150), named
`project16-ubuntu-latest-chromium-performance`. Its **22 members total 9,626,829 uncompressed bytes**. Each copied member
was compared byte-for-byte with both the ZIP and supplied extraction.

The whole ZIP, job log and three API snapshots bring the archive to **27 original files / 11,197,658 bytes**. The separate
archive-scoped byte-preservation rule prevents text normalization; the ledger records every original path, byte count
and hash. Prior archives, master ledgers and publication maps remain unchanged.

The independent text/model owner recomputed all 500 editor samples, 126 workbench samples, 18 UI summary groups,
3168 instrumentation operation samples and their paired aggregates, plus every lazy pair and its dispersion. The
reported statistics, identities, correctness and scope verdicts were consistent with the original evidence.

Preparation used only artifact/JSON reading, byte copying, hashing, source-identity inspection and documentation work.
**No test, build, benchmark, browser capture, scanner or qualification was executed for this archive.**

[run]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37186353254
[job]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37186353254/job/111388977941
[review]: https://github.com/wieslawsoltes/SharpForge/pull/4453
