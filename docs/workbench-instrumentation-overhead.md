# Workbench instrumentation overhead — SF-A19-T11.1 / #1578

The issue asks for exported startup, document switch, tool activation, command latency,
and input-delay metrics with p50/p95/p99, and instrumentation overhead below 1%.
The overhead measurement uses the actual production Studio application. A standalone
`WorkbenchPerformance.start/end` microbenchmark cannot establish application overhead.

## Product configuration

`environment.performanceTracing` is a validated boolean in the version 2 settings
schema. It defaults to `true`, supports user/workspace scope, and is available as
**Tools → Options → Environment → General → Record workbench performance traces**.
WorkbenchShell loads the setting before creating its metrics instance or starting
the startup mark. Later settings updates affect only that shell. Explicit
`performance.enabled` embedding options take precedence, including `false`.
`mountStudioComposition` and `mountStudioShell` forward this optional instance option.
Disabling tracing retains existing samples; a newly created disabled instance has none.
Marks are instance-owned and single-use. Changing the enabled boolean starts a
new recording epoch: pending marks from an earlier epoch are discarded without
reading the clock, even after tracing is re-enabled. Assigning the same boolean
does not invalidate current marks. A foreign or copied mark cannot be completed.
The disabled baseline uses the product's normal early-return branches and input
listener; the experiment measures the incremental cost of enabled trace recording.

## Capture protocol

After the production artifact and the existing Playwright dependency/browser have
been prepared, invoke one engine explicitly:

```sh
node scripts/bench-workbench-overhead.js --browser chromium --output artifacts/project16/instrumentation-overhead-chromium.json
```

Firefox and WebKit use the same entrypoint with `--browser firefox` or
`--browser webkit` and separate output files. Runs are serial and explicitly
requested. `SHARPFORGE_PLAYWRIGHT_MODULE` selects an already installed driver;
`CHROMIUM_EXECUTABLE`, `FIREFOX_EXECUTABLE`, and `WEBKIT_EXECUTABLE` can select
existing executables. No dependency installation or implicit build occurs.
The driver starts `scripts/serve.js` over the existing `dist` artifact with the
production CSP, or uses an explicitly supplied local HTTP `--url` /
`SHARPFORGE_BROWSER_URL`. In-memory documents and remote origins are rejected.

The completed build writes `artifacts/results/build-identity/manifest.json`
after all production transformations. This local sidecar binds the source Git
revision/tree and clean/stable status to every completed asset's bytes and SHA-256.
It publishes no status paths, untracked file inventory, or environment values.
It stays outside `dist` and release payloads, preserving deterministic archive
rebuilds without Git metadata. Ordinary archive/development builds still work;
unknown or dirty source provenance cannot support an exact-source measurement.

Before timing, the driver requires a clean checkout matching the build's source
revision/tree and verifies the local asset inventory. It records driver, harness,
source, local artifact, and observed served identities separately; the driver
commit is never presented as an unverified served commit. Both the default server
and an explicit local URL undergo the same serial HTTP byte verification before
and after capture. HTML bytes must match their sealed local asset hash before
applying the production server's explicit CSP transformation. Stale source,
modified assets, different served bytes, or missing provenance fail closed.
Each verification phase has a two-minute bound and is outside all timed spans.

The fixed `studio-instrumentation-overhead-v1` protocol performs 12 pairs, each
with one enabled and one disabled capture in fresh isolated browser contexts.
Pair order alternates disabled/enabled, then enabled/disabled. Both contexts
receive identical pre-navigation saved settings, except for the tracing boolean.
First-run/start dialogs are disabled in both. The browser process is shared;
the report records this, the exact engine/version, OS/CPU/Node environment,
viewport, each page's navigator data, source commit, fixture SHA-256, and timings.
No browser or product methods are replaced and no global benchmark flag changes
application behavior. Harness-owned listeners observe real trusted input.

Each capture measures:

| Operation | Count | Actual endpoints and correctness evidence |
| --- | ---: | --- |
| Startup | 1 | Native navigation start → DOMContentLoaded end; synchronous module/application bootstrap. The real shell and selected tracing mode must exist. |
| Document switch | 32 | `shell.navigate` invocation → resolution; current URI must equal the requested source. |
| Cold tool activation | 3 | `shell.activateTool` invocation → resolution for Command Window, Bookmarks, and Test Explorer; each must be initially unmounted, then mounted and visible. |
| Registered command | 64 | `shell.execute('workbench.bookmark.toggle')` invocation → resolution; the real bookmark collection must alternate added/removed. |
| Trusted editor input | 32 | Window capture of trusted `keydown` → window bubble of trusted `beforeinput`, after the real editor insertion handler; exactly 32 `x` characters must reach the model. |

The later operations use a fixed 17-source C# project, imported through the real
`sharpforge.loadDiskRecords` path. Initial sample readiness, fixture import,
Playwright transport, frame settling, and report export occur outside all timed
spans. No artificial wait contributes to the denominator. Startup excludes the
asynchronous default workspace build; input is browser dispatch/model insertion,
**not** OS input latency, input-to-paint, or a frame budget. Later API timings
include their real asynchronous completion, with no forced frame wait inside them.
The driver limits each context capture to 60 seconds and all paired captures to
15 minutes. Missing browsers, startup/fixture failures, CSP/page errors, missing
operations, wrong tracing mode, or incomplete input fail the capture.

## Assessment and artifacts

Every raw external duration, every product trace (including its p50/p95/p99
summary), every pair/order/mode, and verified operation counts are retained in
the JSON output. Partial captures are written after each context and on failure.
Product summary percentiles are recomputed from the exported raw samples.
Enabled traces must contain all five required metric categories; disabled
contexts must export empty traces. The assessment validates the fixed workload,
fixture, alternating order, complete operation counts, and observed mode.

For each pair, the driver sums the nonoverlapping measured startup and operation
spans. The sole acceptance gate is:

`100 × (sum(enabled paired totals) − sum(disabled paired totals)) / sum(disabled paired totals) < 1`

The denominator therefore contains exactly one startup plus the listed later
operations per context. Per-operation totals, distributions, and overhead
percentages are separate diagnostics; they are not substituted for the aggregate
acceptance criterion. Exact 1% fails. Negative differences are retained. There
is no trimming, outlier deletion, repeated capture until success, noise-based
pass, or ignored regression. Clock-quantized zero durations remain zero; a zero
per-operation denominator is reported as unavailable, and a zero whole-workload
denominator fails. A completed measurement above the limit retains the complete
assessment and exits nonzero.

This is one bounded observation on a shared host and a specified workload, not
statistical proof that instrumentation is below 1% for every application or
platform. Engine/platform claims require that exact capture artifact. The
implementation does not claim an unrun browser measurement or manufacture an
overhead result from the synthetic unit fixtures.

## Implementation evidence and pending qualification

The production setting lives in `settings-store.js`, `options/general-pages.js`,
`perf.js`, `shell.js`, and the two Studio composition adapters under
`apps/studio/workbench`. The driver is `scripts/bench-workbench-overhead.js`;
`scripts/workbench-overhead/` contains the fixed protocol, production server
lifecycle, browser operations, capture orchestration, and strict assessment.

`tests/a19-instrumentation-settings.test.js` covers real shell construction,
boolean/default/workspace semantics, explicit override precedence, instance
isolation, live updates, the Options checkbox, and disabled observation cleanup.
`tests/a19-instrumentation-overhead.test.js` uses explicitly synthetic fixtures
to test strict threshold boundaries, negative observations, aggregate versus
per-operation semantics, missing/invalid evidence, percentile recomputation,
zero durations, immutable workload identity, and production-origin restrictions.
`tests/a19-instrumentation-artifact.test.js` uses tiny real temporary directories
and local HTTP servers for completed-build identity, unchanged release bytes,
stale local/served assets, source mismatch, sealed HTML, final verification, and
the behavior-preserving module-path extraction from frozen `scripts/build.js`.

At this source-complete handoff, these new tests and all browser captures are
**unrun**. The parent qualification batch must run them after the full correction
scope is integrated. There is no measured under-1% acceptance claim yet.
