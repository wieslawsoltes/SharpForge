# Release 0.15 cross-area acceptance fixture

Implementation of SF-R015-T04 (#426), stacked on T12 (#3261). No local test,
build, browser, device, provider or archive qualification was executed for this
batch. All actual release acceptance remains unqualified. The blocked dependency
labels and parent issue stay open.

The fixture is `tests/conformance/release15/scenario.json`. Each release
obligation has executable component checks or concrete blocked steps with real
owner task IDs. The runner continues independent checks and writes every failed,
blocked and unexecuted row. Component passes cannot override blocked release
obligations. Product defects belong to the linked area owners.

Use a clean committed checkout, the existing pinned Node/npm tools, built Studio
assets and Python Playwright/Chromium setup, then explicitly run:

```sh
node scripts/conformance/release15/run.js --output artifacts/results/release15-run1
```

Set `PYTHON` to the desired existing Playwright interpreter. The output directory
must be new. This command runs actual local components; it neither clones a
provider repository nor authenticates, pushes or publishes anything. No token,
account or remote endpoint flags exist.

The runner reuses T12 CLI/DAP and Studio scenario adapters. Its browser actions
use the same T12 Python session/RPC loop through the default-preserving
`main(dispatch_step=dispatch)` extension. That exact shared adapter file was
approved by its owner and added to the lease; there is no second browser harness.
The A29 manifest's existing recursive test glob discovers the focused unit tests.

| Obligation | Runnable component / remaining blocker |
| --- | --- |
| Remote solution and two documents | CLI three-project debug scenario; local Dashboard/Monitor/Shared fixture edits both C# documents, checks undo/redo, caret, keymap, breakpoints and explicit global designer Design/Split/Code views. Remote Git and independent designer sessions remain blocked by A25 and A18. |
| Two apps and two instances | The `sessions` action launches Dashboard, Monitor and a second Dashboard together in actual Studio with three production runtime Workers and separate compiler Workers. It exercises process selection, a breakpoint/step/continue, live designer attachment and wrong-target rejection, targeted stop/restart, explicit per-session grant/revoke UI, and real pending worker request cancellation. Hot Reload is attempted through the actual editor: another live instance currently keeps that project document read-only, so `MULTI-APP` stays blocked while safe independent phases continue. No editor unlock, model injection, duplicate stop or replacement host manufactures a pass. |
| Numeric and network work | Real ComputePool workers run alongside real loopback HTTP/WebSocket traffic; cancellation/disposal and continued component usability are checked. Cross-app fairness, budget admission and independent grant revocation remain blocked by R015-T02/A12-T10. Timings are raw observations, not a latency qualification. |
| Rendering and device loss | Actual Studio graphics run separately through Canvas2D, DOM and requested WebGPU, retaining observed backend and adapter metadata. A real RenderSurface device is deliberately destroyed to capture its actual device.lost fallback and retained pixels. Fallback is blocked for the GPU obligation; neither software adapters nor deliberate destruction qualify physical hardware faults. |
| Two downloaded app HTML files | A26 APIs are absent. Planned checks cover concurrent filenames, SHA-256, dependency closure, actual bytes offline/file and served, and absent Studio/compiler/recovery/credentials. The IDE standalone file is never substituted. |
| Controlled provider auth | PAT, PKCE/device flow, cancellation/logout and non-fast-forward protection remain blocked by A25. No provider mutations, credentials or synthetic successful auth are implemented. |
| Keyboard, DPI, themes, designers | The actual toolbar Designer icon/label centers and size are asserted; Enter opens the designer, Tab reaches a visible control. Light/dark and 1440/800px viewports are captured at emulated DPR 1/2. Document-owned independent designers and physical DPI/other engines remain unqualified. |
| Exact release archive | Optional explicit archive inputs below verify supplied bytes against a commit, extract twice, rebuild artifacts/packages/examples and compare trusted release hashes. Missing inputs produce a recorded blocker. |

The exact source archive path, expected SHA-256, exact Git commit and trusted
release reference report must be supplied together. A reference may be a T12
clean-clone capture (`report.json`, with `build`) or an A29 T09 double-build
summary. Keep its provenance and original output bytes alongside the reference.

```sh
node scripts/conformance/release15/run.js \
  --output artifacts/results/release15-archive-run1 \
  --archive /path/to/exact-release-source.zip --sha256 ARCHIVE_SHA256 \
  --commit EXACT_COMMIT --reference /path/to/trusted-release-report.json
```

The existing T09 archive verifier checks every source blob and archive entry
against that commit. Its two builds compare extraction ordering/mtime and golden
example outputs; release15 additionally compares the supplied release reference.
A mismatch is a failure, never a blocker waiver. Nothing uploads the rebuilt
artifacts. Source provenance recovery remains owned by SF-R015-T01.

The multi-app action retains `sessions-report.json` and a screenshot per completed
phase. Its required topology is two project applications, including two instances
of Dashboard: three simultaneous application sessions. An observed Hot Reload
blocker leaves the complete sequence blocked even when independent debugger,
designer and lifecycle checks pass. A failure records the active and unexecuted
phases. Source breakpoints are project-owned; the duplicate instance's selected
debugger mutes breakpoints before the first instance is paused.

Grant checks cover memory-only settings and their binding to a restarted
application, plus targeted revocation; they issue no outbound request and do not
claim HTTP/CORS enforcement. Callback checks post real worker RPC requests and
restart before their reply callbacks run, then require rejection and fresh-worker
usability. They do not fabricate delivery of a stale worker event or qualify late
provider/network callbacks. Those network obligations remain separately blocked.

`report.json` binds commit, Node/platform, scenario and blocker hashes. Every
result artifact is SHA-256 bound; browser steps retain screenshots and backend
records. Exit 0 means every obligation passed, 2 means blockers remain, and 1
means a failure/cancellation/incomplete run. No current run can pass the entire
release while the declared absent product dependencies remain.

Windows/Linux/macOS, Firefox/WebKit, physical mobile/high-DPI devices, physical
GPU adapters, controlled providers, native SDKs, CLR and Rust/Wasm remain
unmeasured unless independently captured. Update `blockers.json` only with
reviewed product integration/evidence; unknown blocker IDs fail. Keep failed
captures and root causes when later integrating the owned area implementations.
