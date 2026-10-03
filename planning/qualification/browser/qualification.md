# A29 T06 measured qualification

The complete local matrix was captured at clean commit `f803047e4fb2d9056596dde26661631e36bb6c10`, after rebasing onto `codex/a29-oracles` / latest main. Each cell verifies that HEAD and clean status remain unchanged through execution. The committed category report retains all 30 measured cells; its missing-platform inventory does not infer Linux/Windows qualification from macOS. The separate workflow defines those runs but they have not run for this change. No physical device or hardware evidence was collected.

Host: macOS 26.6 arm64; Node 24.21.0; Python 3.14.7; Playwright 1.57.0. Actual managed binaries: Chromium 143.0.7499.4, Firefox 144.0.2, WebKit 26.0. The test-only local HTTPS exception applies only to the generated loopback certificate; the read-only deployed smoke uses normal public TLS validation.

| Matrix scope | Cells | Result |
|---|---:|---|
|HTTP / HTTPS / COOP+COEP HTTPS / file|12|11 cells pass supported checks; WebKit file nested compute fails|
|Device descriptor emulation|9|3 iPad cells pass supported checks; 6 phone cells retain overlay failures|
|Accessibility|3|All retain actual name/keyboard failures|
|In-memory harness|3|Pass supported checks; separate harness category|
|Existing published Pages URL|3|Compiler/run/debug pass; enforced CSP is absent in all three|

The 30 cells contain **270 passing checks, 18 tracked failing checks and 30 unsupported checks**. There are zero skipped checks, unexpected failures or unexpected passes. Seventeen cells pass their supported-check gate; no complete cell claims parity because unsupported product/hardware paths remain explicit. Tracked failures still return nonzero exit status. No failure is waived by the per-engine catalog.

Remaining acceptance items:

- **#1153:** The product does not implement a SharedArrayBuffer compute path or a visible non-isolated degradation notice. Transfer-buffer computation is verified in all three serving modes; browser isolation and SAB availability are measured separately. Product work belongs to A10.
- **#1154:** Chromium/Firefox file navigation passes compile/run/debug and compute. WebKit file compile/run/debug passes, but nested compute does not finish within 30 seconds; subsequent Stop/reuse works. WebKit's result is retained as required.
- **#1156:** iPhone/Pixel width footer toggle opens the Solution auto-hide popup but a second tap reopens it instead of closing it. The popup then obstructs controls. Touch docking and keyboard-input/small-viewport paths run independently after cleanup. Physical devices and OS virtual keyboards remain unqualified; Firefox mobile viewport-meta behavior is unsupported.
- **#1157:** `#output-kind` is unnamed in the real accessibility tree. The editor consumes Tab and traps traversal. Chromium/Firefox media-mode menu checks pass; WebKit retains the keyboard trap in those modes too. Findings identify selectors and retain screenshots/ARIA trees.
- **#1158:** `https://wieslawsoltes.github.io/SharpForge/` responds and executes the sample, but supplies no enforced script-src CSP. The post-deploy gate correctly fails. The deployed application's exact build revision is unknown; the recorded commit identifies the harness, not the deployed application. No site was published or modified during testing.

All three engines pass the real inline-script and inline-event-handler CSP negative fixtures, and the accessible-name audit fixture rejects an unnamed control while accepting quoted names. The existing Chromium Studio suite still passes all 29 checks. Its real failure, signal cancellation and cooperative-file cancellation artifact checks pass. Six Node contract tests and nine Python contract tests pass; `npm run check` reports 397 JS modules, zero syntax errors, zero unassigned tests and zero duplicate owners. Compilation of the Python harness also passes. The four exact Python paths are registered in A29's manifest and the named suites have runnable entry points.

The whole implementation preceded the first validation batch. Test-assumption fixes separated genuine findings from DevTools eval privilege, YAML-quoted ARIA names and device emulation metadata. Final capture was repeated at the clean revision above. Raw local traces/screenshots/logs remain in `artifacts/browser-final/`; their SHA-256/byte-size index is retained in `evidence/artifact-index.json`. Hosted jobs upload the same diagnostic files on failure. No hosted or hardware qualification is claimed by local evidence.

Commands and exit codes are retained per engine under `evidence/commands-*.json`. The repeatable entry point is `python tests/conformance/browser/run_matrix.py --engine <engine> --suite <smoke|mobile|a11y|harness>`; deployed mode and negative fixtures are listed there separately. Standalone report generation uses `node scripts/conformance/browser-report.js --output planning/qualification/browser-matrix.json <result.json...>`.

Correctness-gated latency probes launch three fresh browser processes per engine and execute ten warm compile/run iterations in each process. They run sequentially by engine on a shared host, without flushing OS cache or isolating CPU load. These small-sample quantiles are diagnostic, not a performance threshold or comparison of engines. Browser/worker/native allocation counters are unavailable; the recorded allocation peak covers Python only.

|Engine|Cold p95/p99 (ms, n=3)|Warm p95 (ms, n=30)|Warm p99 (ms)|Python peak bytes|
|---|---:|---:|---:|---:|
|Chromium|864.79|80.77|83.43|5,041,955|
|Firefox|4,367.12|413.22|509.20|4,946,611|
|WebKit|2,541.67|190.84|212.10|5,042,821|

The browser workflow preserves existing Chromium artifact names and uses separate artifacts. It runs full browser jobs on main/manual invocation or a PR carrying `full-ci`; ordinary PRs retain the repository's minimal CI policy. The Pages post-deploy job uses `needs.deploy.outputs.page_url`, has read-only permissions and validates the actual site after deployment.
