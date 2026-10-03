# SharpForge 0.7.0 validation — October 2, 2026

## Observed results

| Gate | Result and scope |
| --- | --- |
| Node regression | **1,152/1,152 passed**, 0 failures/cancellations/skips; +146 versus uploaded 0.6.0's 1,006 |
| JavaScript syntax | **119 modules**, 0 errors |
| Browser acceptance | **140 checks passed** across six suites; production modules and real compiler/runtime workers |
| Standalone HTML | **23 checks passed**, two actual Blob workers |
| Offline package verification | **16/16 passed**, installed from tarballs without workspace links |
| Native Microsoft MSBuild / SDK | **Unavailable; gate failed explicitly** (`dotnet ENOENT`). No native project compilation is claimed |
| Hosted Linux/Windows SDK CI | Workflow delivered, **not run here** |

Node v22.16.0; Chromium 144.0.7559.96; Linux x64. The last two rows are not hidden skips and are not included in the passing regression totals. There is no native-SDK success claim for this distribution.

## Test evidence

`core-results-0.7.0.tap` contains the final full Node run; `syntax-check-0.7.0.txt` contains the syntax gate. `package-results.json`, `standalone-results.json` and the following browser reports were regenerated for 0.7.0. Historical filenames and some suite label fields retain the versions in which those suites were introduced; explicitly versioned older release reports remain historical.

| Browser report | Checks |
| --- | ---: |
| `browser-results.json` | 29 |
| `browser-managed-results.json` | 12 |
| `browser-workspace-results.json` | 23 |
| `browser-release05-results.json` | 17 |
| `browser-release06-results.json` | 27 |
| `browser-msbuild-results.json` | 32 |

### Adapter and portable evaluator

New tests exercise validated operation arguments and escaping, configuration/TFM/RID/global properties, target-result queries, response paths, incremental UTF-8 output decoding, diagnostic parsing and project-relative navigation, process launch/failure/cancellation/timeouts/output limits, job serialization, shutdown races, terminal artifact readiness and out-of-root output rejection. Workspace tests use real temporary disk, SHA-256 conflicts, encoding/BOM round trips, symlink/traversal rejection, creation, batch preflight and partial-save reconciliation. HTTP tests use a real loopback server with token, Host/Origin and request-size checks.

The child program is `tests/fixtures/msbuild-process-simulator.mjs`, explicitly labeled as a simulator. Passing those tests proves the adapter contract against that fixture, not Microsoft MSBuild compatibility or build semantics. Its fixture version and outputs are not native MSBuild evidence.

Portable evaluation tests cover local imports/Choose, conditions, item definition defaults, global properties, wildcard ordering, path/import limits and explicit rejection of unsupported native behavior. SLNX tests are data-only structural parsing/creation, not native configuration mapping evaluation. Example tests inspect project XML and required features; they do not compile the native examples.

### Browser and standalone

The six browser suites use production Studio modules and two real dedicated compiler/runtime workers through the in-memory harness. Existing source compilation, PE/CLI output, IL execution/debugging/reverse history, generators/refactoring, large-editor behavior and docking checks remain active.

The new 32-check suite uses an **explicit in-memory native-client test double**. It verifies connect-without-execution, trust, workspace switching, source/XML save, conflict retention, SLNX structural inspection, configuration propagation, native controls and logs, diagnostic source ranges, evaluated/expanded results, custom targets, cancellation, output DLL decompilation, file-input isolation, dirty buffers, raw XML focus, docking and tool lifecycle. Its assembly bytes are real; its native build results are not. `release07-msbuild.png` includes test-double labels.

Standalone tests exercise the packaged self-contained HTML, real compiler/runtime Blob workers, the retained compiler/debugger/editor features, and disconnected native tools/layout. Native build execution is not available in standalone HTML without the local host.

Normal Chromium HTTP navigation was attempted and blocked by environment policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). Production browser HTTP transport is not qualified by the in-memory tests, although the Node HTTP API is tested separately. Browser storage uses the documented harness-only shim, not durable storage.

### Package verification

All sixteen 0.7.0 package tarballs are installed offline into an isolated temporary project with no source workspace links. The gate imports their public exports, compiles/executes genuine PE/CLI output, checks feature APIs and the editor stylesheet, starts the installed LSP/DAP executables, imports browser and Node MSBuild APIs and starts installed `sharpforge-msbuild --help`. This last check verifies the CLI installation, not an installed SDK build.

### Real-SDK gate

`npm run test:msbuild:native` never uses the simulator. It probes installed MSBuild and, when available, builds and executes the example outputs and validates incremental generation/copy, inline tasks, intentional failure, SLNX separate-project output, evaluation/preprocessing/target results, pack/publish/clean/rebuild, local central-package restore and multi-targeting.

Here it exits nonzero immediately because `dotnet` is absent. `msbuild-native-results.json` records `passed:false`, `available:false`, `simulated:false` and no completed checks. A .NET download could not be completed due environment DNS restrictions. Windows native cancellation, real SDK evaluation/restore/tasks, broad native project compatibility and native CLR output execution were not qualified locally. `.github/workflows/ci.yml` contains a separate Linux/Windows .NET 8+10 gate; no hosted run is claimed.

## Reproduce

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run test:packages
npm run standalone
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:managed
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:workspace
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:release05
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:release
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:msbuild
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:standalone

# Separate qualification; requires actual installed .NET 8 and 10 SDKs/reference packs:
npm run test:msbuild:native
```

Python Playwright and Chromium are test-only dependencies. The browser IDE has no external runtime npm dependency. The local host needs Node 22+ and separately installed build tools. The native gate requires a writable temporary directory and uses native build/task/package permissions, not a sandbox.

## Distributed archive

The source archive includes a SHA-256 source manifest, all source/tests/examples/docs, the prebuilt browser and standalone applications and sixteen package tarballs. Generated bundles, dependency installation directories and reports are excluded from the source-manifest set; the complete downloads have separate SHA-256 checksums. The accompanying `SharpForge-0.7.0-final-archive-verification.txt` records verification of the exact distributed ZIP after extraction, including offline install, tests, syntax, rebuild and CLI smoke checks. This is distinct from native-SDK qualification.

## Explicit non-qualification and limits

No normal HTTP/file-origin browser qualification, durable storage qualification, native file-dialog testing, desktop CLR/ILVerify, broad third-party assembly/native-project compatibility, external Visual Studio/VS Code client integration, native process/PDB debugging, hosted deployment or independent security audit is claimed. No new performance benchmark claims are made; older benchmark reports are historical. Native build trust is OS-level execution authority, not a security boundary around the project root. API saving is conflict-checked but not a multi-file transaction or OS lock. Output artifact lists may contain old live files. Full browser MSBuild, C#/CLR and Visual Studio parity remain incomplete.
