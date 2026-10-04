# Hosted qualification contract (SF-A29-T01)

Ordinary pull requests run exactly one **core** job on Ubuntu: dependency restore,
`npm run check`, `npm test`, `npm run build`, and a clean-checkout guard. Configure
**core** as the stable required PR check under the minimal-check policy introduced
by PR #2099. This document does not change repository branch-protection settings.

Main pushes retain the single core job. Full qualification runs on manual dispatch, merge queues, reusable
release calls with `qualification: true`, or PRs carrying the **full-ci** label.
All matrices and job families run serially; see [the scheduling policy](serial-validation.md). Its **ci-ok** aggregate uses
`always()` and fails on any failed, cancelled, skipped or missing prerequisite.
The aggregate is intentionally skipped for ordinary PRs, which must not require it.
Core Linux coverage comes from `core`; the gated `core-platforms` matrix adds
Windows and macOS. Package installation, all 15 browser shards, desktop CLR (.NET
8 and 10), and real MSBuild (.NET 8 and 10 together) retain their three-OS matrices.
Each browser shard consumes one uploaded build; standalone consumes that build's
HTML. Matrix fail-fast is disabled. Full qualification is an explicit completion
step, not a claim that a core-only PR run qualified browsers or native runtimes.

Push CI triggers only on main. PR events are opened, synchronize, reopened and
labeled; adding `full-ci` starts full qualification. Implementation and agent
metadata branch pushes do not start duplicate runs. Superseded PR runs cancel in
the same workflow/PR-number concurrency group. Main and release work are retained.
Every job has a hard timeout; the browser supervisor gives each suite 20 minutes
and then requests cancellation with 60 seconds for diagnostics, within a 30-minute
job limit. Host termination or runner loss can still prevent final artifact upload.

Full qualification jobs capture environment information and refresh it at the end:
commit, OS image/release/architecture, Node/npm/Python, pinned Python Playwright,
Chromium manifest revisions/installation, optional executable override, and actual
.NET SDK/runtime information. Missing tools are explicit unavailable probe results,
not invented versions. `env.json`, checkout status and all suite evidence upload
under `artifacts/results` even when checks fail. `git status --porcelain=v1` rejects
tracked mutations, staged changes and unignored output; no step restores mutations.
Generated package, native, browser and CLR-Wasm reports default to that directory;
`SHARPFORGE_RESULTS_DIR` may override it. Standalone defaults to
`artifacts/SharpForge-standalone.html`, configurable with `SHARPFORGE_STANDALONE_PATH`.
The historical checked-in standalone and docs reports are not fresh CI evidence.
`.gitattributes` pins LF for detected text so npm does not rewrite checked-out
Windows shebangs, while binary fixtures retain their bytes. Filesystem consumers
use URL objects or `fileURLToPath`; Windows native managed exits are compared as
unsigned DWORD values, while POSIX compares the low eight bits.

The pinned supported browser is Chromium from `tests/requirements.txt`. Browser
caches are keyed by OS, architecture and the requirements hash, and Playwright's
installer still verifies the required browser and installs OS dependencies on every
run. `CHROMIUM_EXECUTABLE` overrides the executable only when it names an existing
file. Paths containing spaces work. Other engines are not claimed as qualified.

All browser entry points use `launch_browser` and `load_application`. The default
loads `scripts/serve.js` over loopback HTTP and asserts the production CSP is present
and does not permit unsafe-eval. `SHARPFORGE_IN_MEMORY=1` explicitly selects the
restricted Blob-module harness and does not qualify navigation or native storage.
The standalone suite explicitly injects its single HTML artifact into about:blank;
it does not qualify OS file-URL policies or persistence. The MSBuild UI test double
and native Explorer Python transport adapter retain their limitations in reports;
neither substitutes for the real `native-msbuild` or `native-il` jobs. Runtime
network tests add only their own exact loopback origin to the production CSP.

Failure and cancellation retain `<suite>/trace.zip`, `console.log`, `screenshot.png`
and `session.json`. Console output is flushed as it arrives. A real-browser smoke
regression forces assertion failure, native cancellation and cooperative-file cancellation and verifies the
ZIP contents, PNG signature and log message. Browser disposal is owned by the shared
context manager, so cleanup executes after failure capture. Successful sessions
retain their console/session metadata and discard tracing snapshots.

CLR Wasm is **not qualified** in hosted CI: its application-specific independently
built trimmed runtime is not provisioned. `skips.json` tracks #1119, the exact missing
prerequisite and removal condition. The `clr-wasm` job uploads this exclusion; it is
not reported as execution success. Desktop native jobs use real installed SDKs and
never the process simulator.

Tag releases always execute full qualification through this same reusable workflow for the exact tagged checkout and depend on its
successful aggregate. They download that run's qualified browser and package builds,
create a deterministic inventory of released payload bytes, verify it, and attach
`SOURCE-MANIFEST.json` plus `SHA256SUMS`. The stale repository-root source manifest is
removed: release manifests describe the release assets, not an old local snapshot.

## Runnable local qualification

Use Node 22+ and Python with `python -m pip install -r tests/requirements.txt`, then
`python -m playwright install chromium`. These commands do not modify tracked reports:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
node --test tests/conformance/*.test.js
python -m unittest discover -s tests/conformance/browser -p 'test_*.py'
npm run build
node scripts/standalone.js
npm run test:packages
python tests/conformance/browser/artifact_smoke.py
python tests/conformance/browser/benchmark.py --iterations 10
python tests/conformance/browser/run_suite.py release08
python tests/conformance/browser/run_suite.py standalone
npm run test:dotnet
npm run test:msbuild:native
node scripts/conformance/env-report.js
node scripts/conformance/clean-checkout.js
```

Run every name accepted by `run_suite.py` to reproduce the whole browser matrix.
Launch timing records cold launch-to-correct-evaluation and warm document/assertion
p95/p99, plus Python allocation peaks; it explicitly excludes Chromium process
allocations and is diagnostic, with correctness assertions retained. Per-suite wall
times are in `suite-*.json`. Hosted serial-versus-sharded wall time must be measured
from actual workflow runs; a smaller duration is not claimed from the YAML alone.

## Capability and regression inventory

| Capability/API | Supported target | Regression/evidence |
| --- | --- | --- |
| `launch_browser(playwright, suite)` | Chromium on three hosted OSes | `test_launch.py`, real `artifact_smoke.py` |
| `load_application(page, connect_origins=())` | Production loopback HTTP/CSP; explicit restricted opt-in | All browser matrix suites |
| `results_dir()` / `resultPath(name)` | Python/Node report writers, custom output path | Launcher unit tests, `qualification.test.js`, checkout guard |
| `checkoutStatus()` | Git worktrees on all three OSes | Actual temporary Git repo: tracked/staged/untracked/ignored cases |
| `checkStatus(needs)` | Full-qualification GitHub aggregate | success/failure/cancellation/skipped/missing fixtures |
| `writePlan(directory, plan)` | Canonical filesystem ancestors, create-only roots | Existing CLI tests and symlink-ancestor/root/inner-link regression |
| macOS Emacs/Sublime caret setup | CodeMirror cursor API; actual key actions unchanged | `browser_release08_test.py` |
| Release payload generator/verifier | Same-commit qualified release assets | Changed/missing/extra binary payload regression and SHA256SUMS verification |
| CLR Wasm runtime adapter | Not qualified without independent runtime publish | Tracked `skips.json`; no native claim |

Issue ownership: #397 leaves #1113–#1120; defects #477, #478, #480, #481. JavaScript
static analysis (#482/#502) is a separate scope and is not claimed by syntax checks.

Policy regression: `qualification.test.js` checks that only core is unconditional,
all expensive jobs share the full-ci/event gate, the aggregate remains strict, and
release callers retain reusable qualification. Validate YAML with actionlint. No
full hosted matrix is needed to validate this trigger-policy-only change.

Windows cancellation uses a unique request file passed to the child through
`SHARPFORGE_CANCEL_FILE`. The browser wrapper checks it after returning from
Playwright's dispatcher and unwinds through diagnostic cleanup. Windows console
break signals reach the entire process group, including the Node driver, so they
cannot preserve a usable browser for trace/screenshot collection. POSIX uses
SIGTERM to the Python child; the file-channel regression also runs on POSIX.

Hosted run 37125167557 artifact 11275690534 established this failure: the driver
closed during `Page.wait_for_timeout`, then cleanup could not emit trace/screenshot.
The correction passed five launcher contract tests and all three real Chromium
artifact cases locally. Windows qualification still requires the hosted rerun.
