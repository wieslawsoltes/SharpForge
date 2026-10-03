# Product acceptance scenarios

Implementation for SF-A29-T12.1–T12.6 (#1191–#1196), ahead of qualification as
requested. No local test, browser, build or reproduction run was performed for
this implementation. These tasks and their blocked dependency labels stay open.

| Scenario | Actual product path | Qualification |
| --- | --- | --- |
| `sample` | CLI project-info/compile; served Studio open/build | Unmeasured |
| `solution-edit-build-debug` | Three-project solution, source edit, PE/PDB build, breakpoints in Math/Core/App, step-out, locals and output | Unmeasured |
| `designer-roundtrip` | Served Studio C# designer synchronization, rebuild, WinUI run, live property apply and scene inspection | Unmeasured |
| `git-publish` | Reserved product actions; A25 Git and A26 application publish are absent | Blocked; never substituted with host Git or IDE packaging |
| Release reproduction | Two separate clones using the existing A29 release builder and byte/hash comparison | Blocked pending two actual operator captures |

CLI debugging uses the real stdio DAP executable and direct CIL VM. The CLI
currently combines referenced project sources into one compilation; this does
not qualify independently linked assemblies. Studio uses its current source VM
and production compiler/runtime workers over HTTP. Its existing launcher uses
Chromium. Firefox, WebKit, physical mobile devices, native Windows WinUI, CLR and
Rust/Wasm are not qualified by these scenarios.

Use a clean committed checkout. Install the pinned Node/npm environment and run
the repository's normal dependency/build setup before browser scenarios. Studio
also needs the existing Python Playwright environment and its Chromium browser.
No setup or build is silently performed by the scenario runner.

```sh
node scripts/conformance/acceptance/run.js \
  --scenario tests/conformance/acceptance/scenarios/sample.json --target cli
node scripts/conformance/acceptance/run.js \
  --scenario tests/conformance/acceptance/scenarios/solution-edit-build-debug.json --target cli
node scripts/conformance/acceptance/run.js \
  --scenario tests/conformance/acceptance/scenarios/solution-edit-build-debug.json --target studio
node scripts/conformance/acceptance/run.js \
  --scenario tests/conformance/acceptance/scenarios/designer-roundtrip.json --target studio
node scripts/conformance/acceptance/run.js \
  --scenario tests/conformance/acceptance/scenarios/git-publish.json --target cli
```

Set `PYTHON` when the Playwright environment uses a different interpreter.
`--output` selects a new report directory; existing directories are rejected to
prevent stale evidence reuse. Default paths are under
`artifacts/results/acceptance/<scenario>/<target>`. Each completed step retains
JSON with its SHA-256; Studio additionally retains screenshots and browser logs.
Failed/unexecuted steps remain visible. Reports bind the source commit, input
scenario hash, blocker ledger hash, platform and Node version. Exit codes are
0 passed, 1 failed/cancelled, and 2 blocked. Unknown blockers fail.

Schema changes belong in `tests/conformance/acceptance/scenario.schema.json`.
Actions operate through the CLI/DAP or Studio APIs; scripts are not scenario
input. Inputs have bounded step counts, path rules and timeouts. Blocking is
recorded per scenario and target in `planning/qualification/blockers.json` and
validated against actual task IDs in the backlog snapshot. All required blocked
dependencies are reported before executing the first step. Unexpected product
failures remain failures until investigated; they are never silently converted
to a known blocker.

Host-only unit tests are registered by the existing A29 recursive test glob.
Their injected adapter/capture records test harness policy and are not product
qualification. Execute actual scenarios and the independent release protocol
from [reproduce-release.md](../reproduce-release.md) in the later qualification
batch. Keep exact reports and commits before closing any leaf.
