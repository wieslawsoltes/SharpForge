# Lazy module evaluation measurement

Work item: **SF-A19-T11.3 / #1580**. The acceptance criterion asks for a measurable
initial script-evaluation decrease and working first activation offline in the
standalone artifact. This driver measures the former; the existing standalone
workflow's actual offline tool activation remains a separate required result.

After the complete scope is integrated, committed, built and otherwise ready for
its scheduled serial qualification slot, run:

```sh
node scripts/limited.js node scripts/bench-workbench-lazy-evaluation.js --browser chromium --output artifacts/project16/lazy-evaluation.json
```

The driver never builds, installs browsers, retries samples, or changes product
settings/code to force eager behavior. It uses the existing Playwright loader and
production HTTP/CSP server. An explicit local `--url` or `SERVE_ROOT` must serve
the exact completed production artifact for the current clean source revision.
The build sidecar under `artifacts/results/build-identity` links that revision to
asset hashes. Every served product asset is verified before and after capture;
the report also retains hashes of the harness and all four fixture resources.

The comparison is a **same-source eager-entry counterfactual**, not a historical
speedup. Two otherwise identical HTML overlays replace the one production module
entry with small external wrappers. Both import `studio.js` and end with the same
`console.timeStamp` marker. The eager wrapper first statically imports the five
actual deferred controllers: Designer, Assembly Workbench, Disassembly, MSBuild
and Wizard. All product JavaScript, worker, CSS and other bytes are unchanged.
The wrappers add identical measurement scaffolding to both cases. No global
methods are replaced, product flags added, or waits inserted into the timed span.

The driver enables Chromium CDP `Performance` with `timeDomain: threadTicks` before
navigation. It retains the complete baseline vector and the synchronous
`Performance.metrics` event emitted by the exact entry marker. `ScriptDuration`
is cumulative main-thread JavaScript execution through entry completion; the
reported milliseconds subtract the pre-navigation baseline. This includes actual
Studio bootstrap execution and any main-thread JavaScript run before the marker.
Compile duration is retained separately. Network wait, worker CPU, layout, paint,
wall startup and first tool activation are not this metric. The post-marker
product-ready assertion cannot extend the captured metric interval.

The marker mechanism follows Chromium's
[InspectorPerformanceAgent](https://chromium.googlesource.com/chromium/src/+/97e0f013d49d99a455afe1609c387a3662cf8fd2%5E%21/):
`ConsoleTimeStamp` synchronously collects metrics and emits them with the supplied
title. Unsupported engines/clocks fail rather than guessing equivalent behavior.

The protocol is fixed at twelve alternating pairs, with a fresh Chromium process,
renderer/profile and context for each of the twenty-four captures. Filesystem and
host caches remain shared. Each capture includes launch and cleanup within its
60-second bound (four seconds reserved for cleanup); the whole capture has a
15-minute deadline. A failed or missing marker, unsupported thread clock, changed
asset identity, wrong module graph, product error, or incomplete sample set fails
closed. Firefox and WebKit produce an explicit unsupported failure: no other
clock or fabricated sample substitutes for Chromium's metric.
Normal downstream request cancellation during browser shutdown is counted
separately; actual upstream failures and timeouts remain fatal. The CSP check
compares parsed generated directives, retaining permitted inline styles without
relaxing script execution policy.

Every signed eager-minus-lazy observation is retained, including negative and
zero values. The gate requires a strictly positive paired aggregate decrease;
the issue specifies no percentage threshold. The report includes signed pair
counts, mean, median, minimum, maximum and population standard deviation. This is
one point observation on the reported host, not statistical proof. OS/CDP clock
quantization is unknown and must remain part of the interpretation. No samples
are trimmed, padded, rounded into a pass, or captured repeatedly until favorable.

`tests/a19-lazy-evaluation.test.js` covers fixed entry construction, real local
HTTP byte/CSP preservation, raw metric and identity rejection, unsupported clocks,
strict no-improvement failure, and process ownership/timeout cleanup contracts.
Its synthetic metric fixtures test the harness only and are never performance
evidence. No new browser timing or passing qualification is claimed by this source
change; the scheduled capture and independent standalone activation must supply it.
