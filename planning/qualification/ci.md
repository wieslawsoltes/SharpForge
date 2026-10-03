# Hosted qualification contract (SF-A29-T01)

The required GitHub branch-protection check is **ci-ok**. Configure that one stable
check; its `always()` aggregate fails on any failed, cancelled, skipped or missing
prerequisite. Matrix job names are evidence, not separate branch-protection rules.
This document does not claim that repository protection settings have been changed.

Core, package installation, every browser suite, desktop CLR (.NET 8 and 10), and
real MSBuild (.NET 8 and 10 installed together) run independently on Ubuntu, Windows
and macOS. Each browser shard consumes the same uploaded build; standalone consumes
the HTML created in that build job. Matrix fail-fast is disabled. Main-branch pushes and pull requests trigger CI. Feature and lease-metadata
branch pushes do not start a second copy of the pull-request matrix. Superseded pull-request runs cancel through the workflow/ref group.
Every job has a hard timeout; the browser supervisor gives each suite 20 minutes
and then requests cancellation with 60 seconds for diagnostics, within a 30-minute
job limit. Host termination or runner loss can still prevent final artifact upload.

Each job captures environment information before setup and refreshes it at the end:
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
regression forces both assertion failure and signal cancellation and verifies the
ZIP contents, PNG signature and log message. Browser disposal is owned by the shared
context manager, so cleanup executes after failure capture. Successful sessions
retain their console/session metadata and discard tracing snapshots.

CLR Wasm is **not qualified** in hosted CI: its application-specific independently
built trimmed runtime is not provisioned. `skips.json` tracks #1119, the exact missing
prerequisite and removal condition. The `clr-wasm` job uploads this exclusion; it is
not reported as execution success. Desktop native jobs use real installed SDKs and
never the process simulator.

Tag releases call this same workflow for the exact tagged checkout and depend on its
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
| `checkStatus(needs)` | GitHub workflow aggregate | success/failure/cancellation/skipped/missing fixtures |
| `writePlan(directory, plan)` | Canonical filesystem ancestors, create-only roots | Existing CLI tests and symlink-ancestor/root/inner-link regression |
| macOS Emacs/Sublime caret setup | CodeMirror cursor API; actual key actions unchanged | `browser_release08_test.py` |
| Release payload generator/verifier | Same-commit qualified release assets | Changed/missing/extra binary payload regression and SHA256SUMS verification |
| CLR Wasm runtime adapter | Not qualified without independent runtime publish | Tracked `skips.json`; no native claim |

Issue ownership: #397 leaves #1113–#1120; defects #477, #478, #480, #481. JavaScript
static analysis (#482/#502) is a separate scope and is not claimed by syntax checks.
