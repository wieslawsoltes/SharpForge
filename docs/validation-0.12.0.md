# SharpForge 0.12.0 — validation

This release was reconstructed from the available verified 0.11.0 archive. The missing previously claimed 0.12 source was not found or recovered. All results below refer to this newly built implementation. The source, browser and standalone artifacts are real files produced in this runtime.

## Observed gates

| Gate | Result |
|---|---|
| Node tests | 2,023 passed; zero failures/skips. Baseline 1,809; 214 added including inherited automatic sample coverage. |
| JavaScript syntax | 192 modules, zero errors. |
| Browser acceptance | 296 checks in 12 suites; no page JavaScript errors. |
| Self-contained standalone | 49 checks; actual bundled compiler/runtime Blob workers, zero page/console errors. |
| Independently installed packages | 23/23 packed, installed offline without workspace links, imported and executed. Actual LSP/DAP stdio executables checked. |
| Native SDK/MSBuild | Unavailable because dotnet is not installed; not counted as success. |
| Normal HTTP navigation | Attempted loopback navigation was blocked by runner policy (ERR_BLOCKED_BY_ADMINISTRATOR). Not qualified; no bypass. |
| Physical WebGPU | Not qualified. Browser tests exercise Canvas2D/DOM rendering and fallback behavior; no hardware claim. |

See `node-tests-0.12.0.tap`, `syntax-results-0.12.0.txt`, `validation-0.12.0.json`, per-suite browser JSON files, `standalone-results.json` and `package-results.json` for actual results. Older version-labelled reports are historical; this report's suite data was regenerated for 0.12.

## New coverage

The new designer/model/EnC/styles/examples tests validate all 48 insertable toolbox controls, C# code generation and execution, all four execution paths for shared styles/templates and shipped examples, managed GC roots, property precedence, primitive/value boxing, stable dependency properties, independent template scopes, rollback of invalid resource mutations, capture/diff/live application for source and direct CIL, revision/identity/alias rejection, method/type additions, active-local remapping, appended instance/static fields, delegate identities, suspended tasks and heap-budget rejection.

The new browser suite has 20 checks. It exercises seven live docking tools; actual mouse drag, eight-handle resize, Grid-cell moves and boundary resizing; Ctrl-wheel zoom and Shift marquee; typed property editing; shared styles and independent templates; JSON persistence through complete-workspace ZIP; generated C# callbacks; source and CIL live patches retaining typed text, count, object identity and handlers; actual compiler-worker structural EnC; stale-session rejection; independent JavaScript style/template/input behavior; and real numeric/radio/date/time/tab events from the control gallery.

The 49-check standalone suite includes designer editing and undo, per-instance templates, ZIP persistence, generated managed callbacks, live object/handler retention and source method addition while paused. It runs the packaged HTML, not the ESM test-import helper.

## Environment and boundaries

Node v22.16.0, Python Playwright and Chromium 144.0.7559.96 in Linux. Browser suites load the production modules through the documented in-memory harness because normal navigation is policy-blocked; compiler/runtime are real dedicated workers. The native explorer suite forwards actual client bytes to the real loopback Node host and uses temporary disk files. Native MSBuild UI tests are an explicitly labelled client double, not native compilation.

No native SDK/CLR interoperability, native OS thread attachment, native CLR Edit and Continue deltas, XAML/WinRT/Windows App SDK equivalence, durable browser storage, native directory permission dialogs, external Visual Studio clients or physical GPU qualification is claimed. Compatible native SDK CI jobs remain in the source workflow but were not run here. The CI workflow now includes the designer acceptance suite; a local pass is not a hosted-CI result.

## Source ZIP verification

The companion `SharpForge-0.12.0-final-archive-verification.txt` is generated from an independent extraction of the exact delivered source ZIP. It records ZIP integrity, source-manifest checks, offline install, the full Node suite, syntax, rebuild, standalone byte comparison, offline package execution/repack comparison and fresh designer/standalone browser acceptance. It is separate to avoid making a ZIP contain its own final checksum.

Reproduction commands are in `docs/edit-continue-designer.md`. Project/solution inputs, designs and user code remain explicit; opening a design never grants native build trust.
