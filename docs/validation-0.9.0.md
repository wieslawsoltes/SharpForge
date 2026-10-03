# SharpForge 0.9.0 — validation and limitations

Baseline: the uploaded **0.8.0** source ZIP (SHA-256 `67ad7c6b3531fdfea1b04e896944098a02d0458c9f793430d5b39eab9819be40`). This report measures the delivered implementation, not full language/CLR/MSBuild/Visual Studio conformance. Machine-readable summary: [validation-0.9.0.json](validation-0.9.0.json). Some retained browser suite names/schema versions identify the older features they test; all results listed here were rerun against current 0.9.0 production source.

## Actual results

| Gate | Result | Evidence |
| --- | --- | --- |
| Node regressions | **1,371 passed**, no failures/skips; **131 added** | core-results-0.9.0.tap |
| Syntax | **143 JavaScript modules**, zero errors | syntax-check-0.9.0.txt |
| Original IDE browser suite | 29 checks | browser-results.json |
| DLL/IL browser suite | 12 checks | browser-managed-results.json |
| Workspace/docking browser suite | 23 checks | browser-workspace-results.json |
| Property/IL debugger browser suite | 17 checks | browser-release05-results.json |
| Checked/resources/reverse suite | 27 checks | browser-release06-results.json |
| Native-MSBuild client simulator suite | 32 checks | browser-msbuild-results.json |
| Explorer/keymap suite | 37 checks | browser-release08-results.json |
| Real local-host native file suite | 11 checks | browser-native-explorer-results.json |
| New exact-debugger browser suite | **41 checks** | browser-release09-results.json |
| Browser total | **229 passed**, zero page errors reported | Nine suites above |
| Self-contained HTML | **33 passed**, two real workers | standalone-results.json |
| Independent offline packages | **17/17 installed and exercised** | package-results.json |
| Actual Microsoft SDK execution | **Unavailable / not passing**, dotnet ENOENT | msbuild-native-results.json |

Environment: Linux, Node 22.16.0, Chromium 144.0.7559.96, Python Playwright. The new Node coverage includes 61 engine, 12 adapter, 12 production-runtime-worker and 31 example tests, plus 15 added cases in existing all-example suites. The worker tests bridge Node worker_threads to the production worker's message API; they do not replace its debugger implementation.

## Debugger-specific evidence

The browser regression reproduces CallStackLab line 20 and verifies ten stops, requested/bound location, source span, gutter, call-stack location, hit counts, locals and output-before-execution. Other tests cover multiline continuation binding, method-boundary rejection, same-line columns, CRLF/UTF-16 offsets, recursive/function entries, caller writes after return, pause/step/run-to, selected caller vs execution, safe Immediate, live changed conditions, one-shot/mute, repeated Continue coalescing, deep exception reverse replay, mismatched embedded source, Vim markers/read-only state, and instruction rule flags surviving neighboring edits/restart.

Examples are exercised by four execution routes and both debugger engines. Five new examples are also actually compiled/debugged/run through browser workers; they are not UI-only demonstrations. The fresh package smoke imports every installed public entry, executes compiled and ordinary IL, tests source/direct reverse stops and the DAP configuration barrier, and starts the installed LSP/DAP executables and native-host help.

## Browser and native distinctions

Normal HTTP navigation was attempted and rejected by this runner with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Browser acceptance therefore uses the documented in-memory module/worker harness. Compiler and runtime workers are real. Persistent browser storage is replaced by a harness-only in-memory shim; this does not qualify durable storage, file:// or normal HTTP/HTTPS loading.

The native-MSBuild UI suite intentionally supplies a labeled client simulator and is **not** evidence of an SDK build. The native explorer suite uses the actual production client, loopback HTTP host and temporary disk, with a Python byte-forwarder replacing browser transport only. It tests real creates/renames/deletes/undo, source/XML preservation, DLL opening and conflict rejection. Its baseline capture now waits for the preceding folder operation to finish instead of racing that refresh; repeated final runs pass. No native build is requested by that suite.

The separate `test:msbuild:native` gate exits unsuccessfully with **dotnet ENOENT**. No real SDK build, CLR/ILVerify, Portable PDB, native debugger, external Visual Studio/VS Code client, or broad third-party DLL compatibility qualification was performed. Existing historical release reports are retained but do not substitute for current execution.

## Reproduce

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run test:packages
npm run standalone

SHARPFORGE_IN_MEMORY=1 CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  python tests/browser_release09_test.py
SHARPFORGE_IN_MEMORY=1 CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  python tests/standalone_test.py

node apps/cli/main.js run examples/projects/DebuggerWorkshop/DebuggerWorkshop.slnx
# 42
```

Other browser scripts live under tests/browser*.py and CI contains the corresponding suites. Playwright/Chromium are test-host prerequisites, not downloaded dependencies of the application. In an unrestricted environment, omit SHARPFORGE_IN_MEMORY for the normal browser server path, and separately run the native SDK gates with the required SDKs installed. A workflow file is not evidence of a hosted CI run; no remote workflow was executed in this task.

## Final archive checks

The source release includes a SHA-256 manifest of source, examples, tests, package files, scripts and build metadata. Generated bundles, dependency installations and documentation reports are excluded from that source manifest. The separately delivered `SharpForge-0.9.0-final-archive-verification.txt` records independent extraction, offline install, test/check/build/CLI execution, manifest matching and byte comparison of standalone/package artifacts from the **exact final source ZIP**. It is produced after packaging rather than claiming the ZIP validates itself.

## Compatibility limits

Debugging applies to the supported managed browser engines. Source mapping relies on #SF metadata; older artifacts without new method ranges cannot recover absent boundaries, and reconstructed C# is not a PDB. Watches/Immediate remain deliberately side-effect-free. History has bounded count and estimated storage, cannot retract host effects, and is not full-system time travel. The GC remains non-generational/nonmoving. Complete C#/BCL/CLR, hot reload, native threads/tasks, arbitrary function evaluation, full native Vim and pixel-exact Visual Studio are outside this implementation.
