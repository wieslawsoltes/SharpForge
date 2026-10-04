# Project 16 browser caller corrections

This source batch starts directly from public main
`e990e9342678117090a48516ec736d92104be4b2`, the source of hosted qualification
[run 37171747249](https://github.com/wieslawsoltes/SharpForge/actions/runs/37171747249).
That run passed its A19 and A20 Node stages and launched Chromium
153.0.8010.12. The first browser suite failed before its first assertion:
`browser_a19_docking_test.py` passed a Python lambda to `wait_condition`, whose
current contract accepts JavaScript source strings. The resulting
`predicate.lstrip()` error is retained as a failed browser execution; neither
that suite nor the remaining browser scope is reported as passed. The browser
session recorded no CSP violations or diagnostic cleanup errors.

## Corrected caller contracts

- Both docking readiness/reattachment predicates now pass JavaScript strings.
  The layout, pointer, focus, flyout, popout forwarding and retained-text
  assertions are unchanged.
- Lazy-tool qualification now uses the existing production HTTP/CSP loader and
  startup completion instead of a separate `SimpleHTTPRequestHandler` server.
  It imports the same CSP-safe polling path as the other Studio suites. Its
  readiness predicate returns a boolean instead of serializing a DOM element,
  and its designer predicate awaits the possibly asynchronous automation API.
  Request capture is installed before navigation. The cold five-module graph,
  local-only requests, successful first activation, exact-once requests and
  absence of browser errors remain asserted. Completing the real first-run and
  Start dialogs prevents their overlays from intercepting the later wizard
  close action.
- Insights qualification waits for completed Find state and both actual match
  decorations before Replace All. Incremental search waits for the same expected
  caret and status before asserting its result, and waits for the original
  caret after Escape. Async search/navigation no longer races its assertions.
- Editor-view Undo selects Meta or Control from the same observed
  `navigator.platform` predicate as the editor's native keymap. The model text
  and undo assertions remain identical on macOS and Windows/Linux.

## Complete registered-entrypoint audit

The registration contains eight functional suites and one separate performance
capture. All nine entrypoints were read against the current loader/polling
contracts; the editor-view owner independently reviewed the editor APIs and
selectors. No compatibility wrapper or production implementation was changed.

| Entrypoint | Loader and polling contract inspected | Source correction |
| --- | --- | --- |
| `browser_a19_docking_test.py` | Built docking example, production fixture server, `wait_condition` strings | Two callable predicates corrected |
| `browser_a19_shell_test.py` | `load_application`; string `Page.wait_for_function` uses the imported CSP-safe implementation | No definite caller mismatch found |
| `browser_multi_session_test.py` | `load_application`; string predicates and awaited service operations | No definite caller mismatch found |
| `browser_a19_lazy_tools_test.py` | Production `load_application`; CSP-safe string predicates and startup dialogs | Loader, boolean readiness and awaitable designer predicate corrected |
| `browser_vs_workflows_test.py` | `load_application`; string state predicates and project/designer automation | No definite caller mismatch found |
| `browser_a20_insights_test.py` | Production fixture server; `matrix_common.wait` evaluates JavaScript without `eval` | Find/replace and incremental-navigation completion waits |
| `browser_a20_language_providers_test.py` | Production fixture server; string `matrix_common.wait` and actual provider widgets | No definite caller mismatch found |
| `browser_a20_view_test.py` | Production fixture server; string `matrix_common.wait`, current view/model APIs | Platform-specific Undo key |
| `browser_workbench_perf_test.py` | Production `load_application`; string predicates and awaited activation/paint operations | No definite caller mismatch found |

Python AST parsing covered all nine registered files and confirmed all 36
polling call sites use JavaScript source strings; no browser test module was
imported or executed. This is static source review, not runtime acceptance of
these APIs or selectors. No Node tests, build or browser execution was run for this batch.
The corrected complete browser scope remains pending the integration owner's
serial qualification. Native IME, screen-reader, physical OS shortcut and
desktop-editor oracle acceptance are not implied by the authored fixtures.
