# Project16 hosted attempt a6 — completed comparative failure

Work-ID: **SF-A20-T12**. This is an evidence-only record of the original a6 execution.

**The run failed: 15 of 16 selected scopes passed.** All nine browser scopes, both Node scopes and four independent
performance scopes passed. The remaining performance scope failed its editor latency comparison because three undo p95
measurements exceeded the unchanged 20% relative limit. No performance exception or waiver has been accepted, and this
record does not declare Project16 complete. The original a1–a5 outcomes and archives remain unchanged.

The [machine-readable ledger](project16-hosted-a6.json) maps every scope to its original evidence and records the size and
SHA-256 of all 61 archived files. The [original summary](evidence/project16-hosted/a6/qualification-summary.json),
[source envelope](evidence/project16-hosted/a6/source.json) and [job log](evidence/project16-hosted/a6/job.log) retain their
original bytes.

## Exact execution and comparative inputs

| Field | Recorded value |
|---|---|
| Workflow | [Run 37183721322][run], attempt 1; [job 111381241587][job] |
| GitHub result | `completed` / `failure` |
| Source commit | `25ef23b0fb86eb3be4151492c2ef6bbc51f0a82e` |
| Source tree | `a0922a5f98e4ce38cd377d109a083a1da77df9a1` |
| Trigger | Branch creation; nonce `compare-a5-20261004-a6` |
| Branch | `codex/project16/qualify-ubuntu-chromium-all-compare-a5-20261004-a6` |
| Selection | `all`, `ubuntu-latest`, `chromium` |
| Capture mode | `captureOnly: false`; reviewed baseline profile `a5` |
| Run created / updated | `2026-10-04T06:45:14Z` / `2026-10-04T06:57:34Z` |
| Scope execution | `2026-10-04T06:46:05.437Z` → `2026-10-04T06:57:31.596Z` |

The exact [run](evidence/project16-hosted/a6/github-run.json), [jobs](evidence/project16-hosted/a6/github-jobs.json) and
[artifacts](evidence/project16-hosted/a6/github-artifacts.json) tool-response snapshots are archived separately from the
56 artifact members. They are decoded API-response JSON, not asserted to be raw HTTP wire bytes.

The reviewed profile in [project16-baseline-profiles.js](../scripts/project16-baseline-profiles.js) pins the following a5
files. Archive preparation confirmed these byte counts and hashes against the checked-out source. The profile identifies
a5 commit `c13aa0fd9d27df28b3708bb83d914a04c20a5c7c`, tree `29023ed8b962b6d91671bdb0c0359d905ef2659e`, and run
`37178840757`. Its completed editor and workbench captures are comparison inputs; **a5's overall result remains failed**.

| Pinned file in `docs/evidence/project16-hosted/a5/` | Bytes | SHA-256 |
|---|---:|---|
| `source.json` | 473 | `96a4d8ab7806700ec9539048a6eb8b2b71483fb79bcb013b3c06086475378237` |
| `editor-browser.json` | 38,079 | `d514882e71ede3ec24fabec5337a3a89381d0ca0ced192aac0bdac4aacee42b8` |
| `workbench-large-trace.json` | 29,341 | `4f0c0583e184d63ff58ff1972ed833383d151d3e9aacdb4259900526fe523d83` |

## Completed scope results

The table follows the original summary's scope accounting. The workbench timing capture ran inside `performance`; its
passing comparison does not create a seventeenth scope or change that enclosing scope's editor failure.

| Scope | Original outcome | Principal evidence |
|---|---|---|
| `node:A19` | Passed: 807 tests, 807 passed, 0 failed, 0 skipped | `job.log` |
| `node:A20` | Passed: 722 tests, 713 passed, 0 failed, 9 skipped | `job.log` |
| `browser:workbench-docking` | Passed | `suite-workbench-docking.json` |
| `browser:workbench-shell` | Passed | `a19-shell-results.json` |
| `browser:workbench-sessions` | Passed | `a19-multi-session-results.json` |
| `browser:workbench-lazy` | Passed | `suite-workbench-lazy.json` |
| `browser:workbench-workflows` | Passed | `vs-workflow-results.json` |
| `browser:workbench-workflows-standalone` | Passed | `vs-workflow-standalone-results.json` |
| `browser:editor-insights` | Passed | `a20-editor-insights.json` |
| `browser:editor-providers` | Passed | `a20-language-providers.json` |
| `browser:editor-view` | Passed | `a20-editor-view.json` |
| `performance` | **Failed: editor latency comparison** | `editor-assessment.json` |
| `performance:editor-budgets` | Passed | `editor-ui-budgets.json` |
| `performance:studio-large-file` | Passed | `a20-studio-large-file-results.json` |
| `performance:instrumentation` | Passed | `instrumentation-overhead.json` |
| `performance:lazy-evaluation` | Passed | `lazy-evaluation.json` |

All named evidence above is under `docs/evidence/project16-hosted/a6/`; the JSON ledger contains exact paths. The A20
skips retain their original reasons: eight explicit native Vim capability/oracle boundaries and one comparison requiring
the pinned Unicode 16.0 `Intl` host. They are not passing test cases.

The archive contains 13 browser session reports: the nine browser scopes, workbench performance, separate Code Definition
and overview sessions, and Studio large-file performance. All report `passed: true`, zero CSP violations and zero session
diagnostic errors. The standalone workflow records an actual offline `file://` launch, no HTTP attempts, and artifact
SHA-256 `da60ffe742f3b723d4b1286fc279c6510067570a7cc54b6550d68e2fcfb855a9` for the 16,419,776-byte HTML. These browser
results do not override the separate editor comparison failure.

## Editor comparison failure retained

The [raw browser report](evidence/project16-hosted/a6/editor-browser.json) contains 25 operation/size rows and **500 retained
measured samples**, with three warmups and 20 measured samples per row. The independent text/model owner recomputed all
counts, p50/p95/p99, minima, maxima and comparison deltas from those samples and found them consistent with the original
reports. Correctness passed, and the comparator reports no environment changes.

The [assessment](evidence/project16-hosted/a6/editor-assessment.json) retains these three failures:

| Undo input-to-two-RAF size | a5 p95, ms | a6 p95, ms | 20% limit, ms | Observed increase |
|---|---:|---:|---:|---:|
| 1 MiB | 36.5 | 51.2 | 43.8 | 40.274% |
| 10 MiB | 29.3 | 53.2 | 35.16 | 81.570% |
| 100 MiB | 41.8 | 58.7 | 50.16 | 40.431% |

The respective medians were 30.8 → 29.8 ms, 28.6 → 28.6 ms and 28.8 → 29.6 ms. At 20 samples, the nearest-rank p95 is the
second-highest observation. The timing capture contains no scheduler or GC trace, so these measurements do not establish
a cause. The failed relative result remains failed; neither the medians nor an unsupported noise explanation replaces it.

The separate **200 MiB typing absolute budget passed: p95 32.3 ms < 50 ms**. These are headless browser event-to-two-RAF
upper-bound timings, including frame scheduling. They do not measure physical keyboard-to-display latency. All original
raw values, including other operation tails, are retained at full precision.

The [Node model report](evidence/project16-hosted/a6/editor-model.json) and
[GC-retained memory report](evidence/project16-hosted/a6/editor-memory.json) also completed. Their recorded correctness and
memory budgets passed. Model timings exclude browser events and paint; retained memory deltas exclude total allocation
counts, native allocator measurements and browser DOM memory.

## Workbench comparison and independent performance results

The [workbench capture](evidence/project16-hosted/a6/workbench-large-trace.json) **did compare** against the pinned a5 trace
and passed both absolute and relative checks before the enclosing performance scope reported the editor failure. It
retains 126 raw samples across three fresh-context rounds with 501 C# source files. Independent review confirmed all
group counts and percentiles, plus matching environment and fixture metadata.

| Workbench operation | Samples | a5 p95, ms | a6 p95, ms | 20% relative limit, ms |
|---|---:|---:|---:|---:|
| Cold application startup | 3 | 2633.4 | 2602.1 | 3160.08 |
| Workspace startup | 3 | 2651.6 | 2157.3 | 3181.92 |
| Document switch | 60 | 147.3 | 139.7 | 176.76 |
| Tool activation | 60 | 56.9 | 55.4 | 68.28 |

The four independent performance outcomes have distinct contracts:

- **Code Definition and overview:** the [browser UI budget report](evidence/project16-hosted/a6/editor-ui-budgets.json)
  passed its absolute checks. Code Definition retained 54 first/warmup/measured observations and two neutral/latest-caret
  boundary observations, with a maximum of 166.5 ms against the 300 ms budget. Its exact four workspace records, three
  source documents, project ownership and observed definition DOM proof are present. The overview retained 105
  observations over 10,000 lines and three widths; all render-plus-pixel-readback durations were at most 1.9 ms against
  the 16 ms budget. `renderMs` and following-RAF cadence remain separate fields. No comparative verdict, physical frame
  rate or Safari certification is claimed for this report.
- **Actual Studio 200 MiB ingress:** the [functional report](evidence/project16-hosted/a6/a20-studio-large-file-results.json)
  passed the real file-input change path with a synthetic `File`/`Blob`, retained sibling documents, bounded viewports,
  shared-model edit/undo and disposal. The observed open duration was 7278.9 ms; this functional suite does not turn that
  duration into a latency-budget claim. It did not exercise an OS file chooser or measure physical disk throughput.
- **Instrumentation:** the [12-pair observation](evidence/project16-hosted/a6/instrumentation-overhead.json) passed the
  strict aggregate <1% gate. Measured workload sums were 25,310.4 ms enabled and 25,439.4 ms disabled, an observed
  −0.5071% difference. Per-operation diagnostics remain visible: command totals increased 8.2222% and trusted-key input
  totals increased 2.4513%; individual pairs also vary. The aggregate result is a bounded observation, not a general
  speedup or proof that every operation has less than 1% overhead.
- **Lazy evaluation:** the [12-pair browser observation](evidence/project16-hosted/a6/lazy-evaluation.json) passed the
  recorded aggregate `ScriptDuration` gate: 1615.513 ms eager versus 1588.018 ms lazy, a 27.495 ms difference (1.7019%).
  Nine pairs were positive and three negative. All pairs remain in the report; this does not establish a historical,
  worker-CPU, wall-startup or paint speedup, or statistical significance.

## Environment and limits

The captured browser is Playwright-managed headless **Chromium 153.0.8010.12** on Linux 6.17.0-1022-azure, x86-64.
The benchmark host reports Node 24.21.0, V8 13.6.233.17-node.53, AMD EPYC 7763 and four logical CPUs. The production UI
captures use a 1440 × 1000 viewport at device scale 1. Each report retains its own serving, process and timing protocol.

This a6 attempt supplies no Firefox, WebKit, Safari, Windows or macOS execution evidence. Native desktop/Visual Studio
oracle behavior, physical frame rate, actual IME, screen readers, OS clipboard grants and file-picker permissions are not
certified by these fixtures. Other platform attempts and any subsequent source correction or capture require their own
identities and outcomes. Evidence preservation does not auto-close issues or approve the failed performance result.

## Byte-exact archive

The [original ZIP](evidence/project16-hosted/a6/p16-hosted-a6.zip) is preserved whole. The
[artifact upload](https://github.com/wieslawsoltes/SharpForge/actions/runs/37183721322/artifacts/11296302001) records ID
`11296302001`, name `project16-ubuntu-latest-chromium-all`, and the same size and digest as the supplied download.

| Archived original | Bytes | SHA-256 |
|---|---:|---|
| `p16-hosted-a6.zip` | 1,402,514 | `4d18d06390e92f13c47194e89926a85a674c2ed0249405656491571583b2d74f` |
| `job.log` | 315,299 | `dfd8bcdf4bafa3019d0efb8320ae140a219934072eeef6e60ca73790a7f27645` |

All **56 ZIP members**, totaling **9,287,484 uncompressed bytes**, were compared byte-for-byte with the supplied extraction
and copied without modification. Together with the whole ZIP, job log and three API-response snapshots, the archive has
**61 files**. The JSON ledger records an ordered path/size/SHA-256 inventory and identifies which files were ZIP members.

Archive preparation performed only file/JSON reading, byte copying, hashing, source-identity inspection and documentation
work. **No tests, build, benchmark, browser capture, scanner or qualification was run for this evidence change.**

[run]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37183721322
[job]: https://github.com/wieslawsoltes/SharpForge/actions/runs/37183721322/job/111381241587
