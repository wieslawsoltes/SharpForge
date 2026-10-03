# Local qualification — A29 T07

This evidence qualifies the performance service on macOS arm64, Apple M3 Pro,
Node 24.21.0 and Python 3.14.7. It proposes initial size ceilings for review; it
contains no approved historical performance baseline and no remote CI result.
The [machine-readable index](qualification.json) binds every retained report to
its bytes and preserves each actual capture commit.

All 2,835 Node tests pass at implementation commit `6d87bd3`, including 13 service
regressions covering raw schema, mismatches, quarantine expiry, timeout/cancellation,
process descendants, dirty/racing product and harness commits, managed counters,
artifact boundaries, trace digest tampering and committed-only baseline reads.
`npm run check` passes: 30 area manifests, 84 Node files, 17 browser scripts,
408 JavaScript modules, no syntax errors or unassigned tests. Actionlint passes.
Production build, standalone generation and all 25 installed-package smoke tests
pass. All 29 artifact size checks pass.

The [seven actual adapters](current.json) each retain 20 warm samples and a cold
sample: source/CIL VMs, source/CIL dictionaries, scalar/Wasm SIMD compute, and editor
indexing. Allocation-per-operation spread is exactly zero across managed samples;
the VM workloads each perform ten measured collections. These are VM-managed heap
counters; Node heap deltas remain separate and no native allocation claim is made.

The [actual independent A/A run](aa/summary.md) executes seven adapters, 20 pairs
each, in 280 fresh processes across two detached clean checkouts. No regression is
reported. All independent reports and their pair order are retained; no outlier is
removed. The [timed controls](controls.json) separately execute 20 A/A trials with
zero regressions and detect all 20 controlled 15% slowdowns (2.0ms versus 2.3ms).
These controlled delays qualify the statistical service, not product performance.

All five existing producers execute and normalize 74 rows with raw arrays:
core 7, IL 18, release06 7, release14 8 and compute14 34. Compute's final two rows
are one real cold worker startup and one eight-job batch; these single measurements
are descriptive and cannot meet the 20-pair comparison threshold.

Browser runs use production Studio and CSP, real PE/CLI output, keyboard input,
dock clicks and tracing. Each engine executes five fresh starts and first compiles,
50 typing measurements and 50 tool activations. Values below are median / p95 in ms.

| Actual desktop engine | Startup | First compile | Typing | Tool activation |
| --- | ---: | ---: | ---: | ---: |
| chromium 143.0.7499.4 | 353.943 / 880.396 | 5.500 / 6.700 | 32.194 / 41.893 | 36.197 / 46.068 |
| firefox 144.0.2 | 1323.619 / 1673.619 | 9.000 / 10.000 | 36.731 / 55.477 | 44.179 / 65.214 |
| webkit 26.0 | 1066.353 / 1094.300 | 23.000 / 26.000 | 80.552 / 101.651 | 89.918 / 118.642 |

All 15 trace ZIP digests were checked against actual retained bytes (21,500,687
bytes total). Their local artifact paths and hashes are in qualification.json.
ZIP archives remain in ignored artifacts for review and are not part of Git;
future opted-in CI runs upload the complete raw reports and traces for 30 days.
Browser timings include tracing/protocol overhead. This is local desktop-engine
qualification, not deployed-site, mobile or physical-device qualification.

[Measured sizes](sizes.json) include dist 15,026,880 bytes, standalone 3,194,784,
compiler worker 437,605 and runtime worker 727,971, plus each of 25 package tarballs.
Proposed ceilings are measured size plus 15%, rounded up to KiB. The gate reads only
Git-committed policy; PR runs use the base policy and initial bootstrap requires an
explicit reviewer-applied label. Raw baseline writers reject missing samples/env,
and committed baseline readers reject digest tampering and dirty substitutions.

Ordinary PRs receive the core workflow only. Performance jobs require the `full-ci`
label, schedule or manual dispatch; this scope's PR does not request the label.
Linux/Windows measurements and remote workflow executions remain unqualified here.
The captured commits precede this evidence-only commit; no report is reattributed.
