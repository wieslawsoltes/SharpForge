# Performance regression service — A29 T07

Run Node 24.21.0 and npm ci in a clean checkout.

    node scripts/conformance/perf/measure.js --samples 20 --output artifacts/results/performance/current.json
    node scripts/conformance/perf/ab.js --base HEAD^ --head HEAD --pairs 20
    node scripts/conformance/perf/legacy.js
    node scripts/conformance/perf/controls.js
    npm run build
    npm run standalone
    npm run test:packages
    node scripts/conformance/perf/size-budget.js
    python tests/conformance/browser/perf_test.py --engine chromium --iterations 5

benchmark.schema.json defines the common record. The five original benchmark scripts
keep existing output names and summary fields, add rawSamples/coldSamples and
correctness, and accept BENCH_REPORT where they previously wrote docs. The normalizer
rejects summary-only legacy reports. Legacy IL pipeline samples have no historical
cold phase; coldSamples is empty, not synthesized. New adapters measure cold/warm.

A/B uses detached disposable worktrees and isolated npm installs. Within each pair,
base/head order alternates; each operation executes in a fresh Node process, warms
independently, checks expected values and retains complete JSON/stderr. All samples,
including outliers, contribute to median/p95/p99. An exact one-sided paired sign test
(p < 0.01) plus a 5% median slowdown gates regressions after 20 pairs. This does not
guarantee zero false positives. Noisy cases require an explicit expiring quarantine
and remain labelled. A/A and slowdown tests are statistical controls, not native proof.

Adapters register A05 source/CIL, A08 collections, A10 scalar/actual Wasm SIMD and
A20 editor workloads. Add an area without root-package edits via --registry
owner/perf.json to measure.js. Each descriptor has id, area, engine and module;
module exports create({root,adapter}) returning an action that verifies correctness
and returns {ms,checksum,metrics}. Registry modules are trusted executable benchmarks. The registry and modules must be tracked in one clean owner checkout; its commit and raw file hashes are pinned before/after capture and included in comparisons.
A/B also accepts --registry to execute the same owner adapter independently against both checkouts. Use --baseline ID to select the base commit from a committed reviewed baseline; --policy-ref selects its Git revision. Core defaults use the reviewed adapter list. process.js provides cancellable,
bounded subprocess execution for external adapters.

The timed calibration executes 20 actual A/A trials and injected 2.0ms/2.3ms delays, retaining raw timings. It measures the statistical service, not a product or a native runtime.

Managed metrics come from actual VM heap counters: allocations/bytes per logical
operation, collections, total/max pause. Stability uses every sample and 5% relative
spread tolerance. VM execution timing/counters exclude compilation and VM construction. Node heapUsed deltas describe retained JS heap, not total/native
allocation bytes. No CLR/Rust native timing or allocation capability is claimed.

Browser probes use fresh real browser processes, production CSP, real PE/CLI output,
keyboard input and dock clicks through animation frames. Every trace is retained.
First-compile latency is the worker's compile+emit measurement. Input/tool times
include protocol and tracing overhead. Each requested engine must execute; unavailable
engines fail and cannot pass by skipping. Others are explicitly unsupported per run.

Sizes cover dist, each registered worker, standalone and every discovered npm tarball.
Missing artifacts/budgets fail. Only Git-committed policy is read, default HEAD;
The dispatch uses the selected base commit. Initial policy bootstrap requires the
`baseline_reviewed` dispatch input after review because no old policy exists.
Explicit manual CI runs execute paired comparisons, correctness, producer normalization, sizes and
independent browser engines. Raw reports/traces retain 30 days; summaries show all
medians, p95, p99 and verdicts. Baseline update/review procedure is in perf-baselines/.

| Capability | Implementation | Qualification |
| --- | --- | --- |
| Same-runner comparison | detached base/head processes with correctness checks | statistical tests plus real A/A evidence |
| Managed allocation/GC | actual source and CIL counters | independent adapter reports |
| Compute | scalar JS and compiled Wasm SIMD | independently executed adapters |
| Browser latency | Chromium/Firefox/WebKit entrypoint | only actual executed targets qualify |
| Rust/CLR allocation | unavailable | explicitly unsupported |
| Reviewed history | committed raw arrays, environment, hashes and review reference | dirty baseline substitution rejected |

Local measured qualification and raw sample retention: [macOS arm64 evidence](evidence/macos-arm64-2026-10-03/README.md). The initial budget policy is a review proposal, not an approved historical performance baseline.

The workflow uses reviewed immutable action pins from the A29 supply policy.
Only manual dispatch starts the serial broad performance jobs; ordinary PRs and main pushes do not. Readiness changes
have not run local tests, builds or new benchmarks. The retained macOS evidence
continues to identify its original capture commits and does not qualify later
compiler/runtime integrations. Linux/Windows, native CLR/Rust allocations and an
approved historical baseline remain pending. Implementation merge does not imply
that current product performance meets the proposed budgets.
