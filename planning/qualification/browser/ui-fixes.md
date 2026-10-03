# Mobile and keyboard accessibility follow-up

The phone footer now closes its currently open auto-hide panel on a second tap. The output filter has an associated visible label. All five editor profiles provide an Escape, then Tab or Shift+Tab route out of the text input while preserving ordinary Tab indentation. The capture handler is removed when the editor or keymap is disposed, and its accessible description explains the route.

Implementation was complete before validation. Final observations identify clean commit `0e3dc9a0e6ff6eb7d5fd5ec1664fa15ab33ea403`; each matrix cell verifies that the source revision and clean state stayed unchanged. This document and its evidence files are a later documentation-only commit. The original [qualification report](qualification.md) remains the historical baseline; its deployed and harness observations were not rerun or promoted to this revision.

Host: macOS 26.6 arm64, Node 24.21.0, Python 3.14.7, Playwright 1.57.0. Actual browsers: Chromium 143.0.7499.4, Firefox 144.0.2, WebKit 26.0.

| Scope | Result |
|---|---|
|Focused regressions, three engines|45 checks passed, including 3 separately identified synthetic DOM disposal checks|
|iPhone 13, Pixel 5, iPad descriptor emulation|All 9 cells pass supported checks|
|Accessibility and media modes|All 3 cells pass every recorded check|
|HTTP, HTTPS, isolated HTTPS, standalone file|11 of 12 cells pass supported checks; WebKit file nested compute still fails|
|Registered Node suite|2,828 passed; zero failed, cancelled, skipped or TODO|

The focused native-keyboard checks exercise forward and backward focus escape for Visual Studio, VS Code, Vim, Emacs and Sublime profiles, preserve source text, and detect focus recapture. They also cover ordinary indentation and cancellation of the escape gesture by intervening typing. Native touch checks open and close both footer panels repeatedly and verify dismissal by an outside tap. The accessible-name check locates the actual output combobox by its associated label. The disposal boundary uses synthetic DOM events and does not claim native-keyboard coverage.

The shared accessibility traversal uses Option+Tab on macOS WebKit to reach all controls, matching that platform's keyboard navigation behavior. Backward traversal can land on the editor's breakpoint controls; the requirement is to leave the text input. Tests use browser input APIs and do not programmatically focus a destination to claim keyboard escape.

The [24-cell report](ui-fixes-matrix.json) contains **224 passed checks, one known failure and 24 unsupported checks**. Twenty-three cells pass their supported-check gate. Only the three accessibility cells have all-check parity. There are zero skipped checks, unexpected failures or unexpected passes. The report keeps 42 planned targets unmeasured; it does not infer Windows, Linux or physical-device coverage from macOS emulation.

The remaining WebKit file failure retains its nonzero command exit. At the 30-second observation deadline, the product reports `InvalidOperationException: Numerical worker failed` while nested transfer-buffer computation has no completed work; compile/run/debug and subsequent reuse pass. No worker implementation was changed. The previously measured missing CSP on the deployed Pages site, absent SharedArrayBuffer product path/degradation notice, physical mobile hardware, OS keyboards and IME remain outside this fix and unqualified. No deployment occurred.

Per-engine [command records](ui-fixes-evidence/commands-chromium.json), focused regression records and the [core summary](ui-fixes-evidence/core.json) retain the tested revision and observed results. Raw traces, screenshots and command logs remain in ignored `artifacts/ui-final/`; [the artifact index](ui-fixes-evidence/artifact-index.json) records their SHA-256 hashes and sizes. Hosted browser jobs run the focused regression command as part of each engine's accessibility job. No hosted full-matrix result is claimed here.

Reproduction uses the normal build and standalone generation described in [README.md](README.md), followed by `python tests/conformance/browser/ui_regressions.py --engine <engine>` and `python tests/conformance/browser/run_matrix.py --engine <engine> --suite <mobile|a11y|smoke>`. Node 24 and the isolated Python environment must both be on `PATH` for `npm test`, because registered archive tests spawn `python` directly.
