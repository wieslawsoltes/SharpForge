# Browser platform qualification — A29 T06

Playwright is pinned by `tests/requirements.txt` (1.57.0). The launcher selects `SHARPFORGE_BROWSER_ENGINE=chromium|firefox|webkit` or its explicit `engine` argument; existing jobs default to Chromium. Browser binaries use Playwright's corresponding revision. No browser security flags are disabled. Browser version, Python, Playwright, OS, architecture, exact Git revision, dirty status, build hashes, commands and timings accompany each result.

Run this example with Node 24 on PATH, Python 3.12+ and the isolated dependencies:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node scripts/standalone.js
python -m pip install -r tests/requirements.txt
python -m playwright install chromium firefox webkit
python tests/conformance/browser/run_matrix.py --engine firefox --suite smoke
python tests/conformance/browser/run_matrix.py --engine webkit --suite mobile
python tests/conformance/browser/run_matrix.py --engine chromium --suite a11y
python tests/conformance/browser/csp_smoke.py --engine firefox
node scripts/conformance/browser-report.js --output planning/qualification/browser-matrix.json artifacts/results/matrix-firefox-http-smoke-desktop/result.json
```

The separate workflow leaves the existing three-OS Chromium artifact contract unchanged. Smoke cells run all three engines on three OSes, through production HTTP, test-only HTTPS, COOP/COEP HTTPS and actual standalone `file://` navigation. Device/a11y/harness cells run each engine on Linux. Unsupported targets never become passing parity rows. Failed cells retain individual screenshots, console, Playwright trace and JSON even when later modes continue. Per-cell timeouts request cooperative cancellation before terminating a stuck child; worker cancellation and subsequent reuse are also exercised inside the product.

The self-signed loopback certificate is public test material. Certificate-error tolerance applies only to local HTTPS contexts. Production responses and CSP are preserved by a reverse proxy around `scripts/serve.js`; only isolation headers are added. `crossOriginIsolated`, secure context and the browser's SharedArrayBuffer primitive are asserted independently of the product's real transfer-buffer compute workload. The product has no SharedArrayBuffer compute path or non-isolated degradation notice; #1153's corresponding product acceptance item remains unsupported pending A10 implementation. The harness does not inject a notice.

CSP events and console policy errors fail every shared-launcher session, including existing suites. The dedicated negative fixture injects inline script and inline event-handler violations and requires the shared launcher's teardown to reject them. These deliberate negatives do not count as clean product sessions. Every Pages deployment runs the bounded [published index/404 policy probe](../security/pages-policy.md) and retains its results. The full deploy smoke opens the actual `deploy-pages` output after that probe passes, verifies HTTP success and restrictive enforced CSP (header or a meta before every script), then compiles/runs/debugs. The browser smoke runs one engine at a time only when a manual Pages dispatch sets `qualify` to true. Missing policy fails even on an otherwise working Pages deployment. No publication is performed by local validation.

Device descriptors qualify desktop browser touch input, layouts, touch docking controls, editor focus and a shrunken 390px viewport. They do not qualify physical phones, mobile operating systems, IME or an OS virtual keyboard. Firefox cannot emulate `is_mobile`; that limitation is separately recorded while viewport/has_touch paths still run. Accessibility uses browser-generated ARIA snapshots for every visible interactive control and retains selectors for unnamed controls; keyboard traversal exercises menus, docking, separators and editor, with forced colors/reduced motion. This is not a complete WCAG audit or assistive-technology qualification.

Report categories are `harness` (in-memory injection/storage shim), `served` (HTTP/HTTPS/isolated/file, each kept separate), `deployed` (actual published URL), and `hardware`. Hardware needs a target/revision/report-digest-bound physical-device observation containing device identity, operator and observation time. Such an attestation is a human evidence input, not something desktop Playwright can manufacture; no hardware record is supplied here. Known failures are engine/platform/mode/suite/device/check-specific and require an issue, reason and measured error signature. Resolved rows cause unexpected-pass failures so stale exemptions cannot silently persist. Known failures keep the runner failing; they are tracked, not exempted. Unsupported rows never count as passed checks and set `parityPassed=false` while permitting supported checks to execute. Deployed results identify the harness revision separately: an application revision without verified deployed evidence remains unknown.

Cold navigation-to-compiler-ready and warm correctness-gated compile/run samples are retained per cell; the category report derives no cross-platform performance claims. Python allocation counters exclude browser/native/worker heaps. Browser allocation accounting is explicitly unavailable across these engines. Three warm samples are diagnostic, not a p99 performance gate; use at least 100 iterations for tail latency studies.

| Leaf | Integration | Scope boundary |
|---|---|---|
|1152|Shared engine launcher, three-OS workflow, engine-specific known failures|Actual executed cells only|
|1153|Production server proxy, HTTPS and isolated modes, compute/SAB checks|No product SAB path/notice exists|
|1154|`standalone_file_test.py` actual navigation, compile/run/debug|Harness injection remains a different mode|
|1155|Shared CSP monitor and negative real-browser fixture|Policy is never disabled|
|1156|iPhone 13, Pixel 5, iPad descriptors, touch controls|No physical hardware/OS keyboard claims|
|1157|ARIA names/roles, keyboard traversal, media modes|Observed label and focus defects fixed; no complete WCAG or assistive-technology claim|
|1158|Post-deploy job using actual output URL|Existing deploy without enforced CSP fails|
|1159|Validated report/category merger and negative unit tests|No hardware qualification without evidence|

Use `python scripts/conformance/browser/latency.py --engine chromium --cold 3 --warm 10` for separately measured cold browser launches and warm compile/run percentiles. `accessibility_smoke.py` proves the name audit rejects an empty button and accepts a YAML-quoted named control on each real engine. Known failure catalogs currently identify only measured macOS cells; the Linux/Windows workflow does not inherit those findings as exemptions. The full browser workflow requires manual dispatch; ordinary PRs and main pushes do not start it.

Workflow actions use the reviewed immutable pins from the A29 supply policy.
Pages write permissions are confined to its deploy job; browser qualification is
read-only. The retained macOS evidence at
`f803047e4fb2d9056596dde26661631e36bb6c10` remains historical, including its
known failures. The separate UI follow-up #2541 fixes the measured touch-toggle,
accessible-name and keyboard-focus defects. WebKit file-mode nested compute,
deployed CSP and the absent product SharedArrayBuffer path remain open concerns;
physical devices and Linux/Windows browser execution remain unqualified.
No local tests, builds or browser captures ran for these workflow readiness
changes. Broader validation is deferred until the integrated scope is complete.

The [mobile and accessibility follow-up](ui-fixes.md) records actual fixes and a separate revision-bound recapture. The [original qualification](qualification.md) remains the baseline for measurements not repeated by that follow-up.
