# Hosted execution of the fixed A05 qualification queue

The additive `a05-performance.yml` workflow runs only on a push to
`codex/a05-performance-qualification-*`, or explicit manual dispatch once the
workflow exists on the default branch. The dedicated branch push is the immediate
execution path. It does not
change ordinary core, the native/browser branch policy, A29 performance, any
runtime code, benchmark fixture, threshold, sample count or statistical rule.
Publishing the reviewed workflow is separate from authoring it; no hosted result
is claimed here. All prior local reports, including misses and inconclusive
intervals, remain evidence of their own revision and runner.

One `ubuntu-24.04` job checks out exactly `github.sha`, disables persisted Git
credentials, and uses pinned Node **24.19.0**. Checkout/setup/upload actions retain
the repository's reviewed action SHAs. Permissions are read-only. `npm ci
--ignore-scripts --no-audit --no-fund` finishes before the measurement queue.
Every measurement child passes through `scripts/limited.js` with explicit test concurrency
1, machine-wide run slots 1 and old-space 512 MiB. These explicit controls apply
under CI too. No other work is started concurrently in this job.

The queue in `scripts/a05/hosted-plan.js` transcribes the integration owner's
prespecified final command plan. It runs the existing CLIs, not a second timing
implementation. It preserves these independent observation sets:

| Sequence | Unchanged protocol |
| --- | --- |
| Fibonacci, then virtual cache | Each 100 pairs, 3 warmups, ABI64, seed12012, 10000 resamples, 900-second deadline |
| Exact-parent hook-free reference, profiler off and on | Each profiler mode 100 pairs, 10 warmups, ABI64, seed12012, 10000 resamples, 1800 seconds |
| Eight remaining target definitions | Selected individually; 100 pairs, 3 warmups, ABI64, 900 seconds |
| Two root visitor rows | 100 pairs, 10 warmups, 20 scans, ABI64, 900 seconds |
| Separate Int32 and Int64 differentials | Respectively 1,000,000 and 10,000,000 cases; ABI32, 900 seconds each |
| Full array and actual Wasm OSR fairness | 1,000,000 elements; ABI32, existing samples20/warmup3 metadata and 900 seconds |
| Float allocation | Seven original children: typed/mixed 0/100k/1M, generic10k positive control; warm100k in10 slices |
| Snapshot retention | Original record-mutation workload, 128 revisions, existing256MiB cap, full-copy restore parity |
| Byref, rectangular/vector array, actual Wasm call latency | Each100 observations/10 warmups, ABI64, existing900-second settings |
| T12 first, repeat, gate | Two complete36-row reports, each100 observations/10 warmups, all engines, ABI32; existing qualification gate |

The two complete T12 repetitions and gate execute on the **same VM in the same
serial job**. This matters because report compatibility includes host identity,
runtime, flags and effective resources. No third prospective T12 report is
required by the original criteria. A hosted baseline is independent of local
baselines and does not prove a pre-A05 product speedup.

The maximum360-minute job budget reflects this full preselected queue, including
1,800 fresh T12 startup children. The orchestration stops starting measurements
and interrupts its active process group340 minutes after the initial journal,
including dependency setup. This leaves approximately20 minutes, less initial
checkout/Node setup, for finalization and upload. Individual CLIs retain every original deadline;
their summed worst-case ceilings plus T12 can exceed the platform job budget.
Completion is therefore not guaranteed. Interrupted and unstarted commands stay
explicitly incomplete; the cap never produces a passing shortened workload.

All25 commands are written as pending before setup. Each command retains its
literal argv, cwd, resource policy, start/end timestamps, raw exit/signal, stdout
and stderr, source identities, report and before/after runner observations.
Independent commands continue after misses, inconclusive intervals or report
failures. Reference failure blocks only the off comparison that needs it. T12
gate execution requires both complete T12 reports. A dirty/moved product or an
external workspace dependency blocks further timing. There are no automatic
retries and no row selection from different attempts.

Final aggregation respects existing output semantics: strict target/off gates
must be met, while enabled overhead requires six complete observations without
an invented overhead threshold. Its original CLI exit2 remains recorded. The
float driver also retains exit2 and overall `partial`; only its explicit original
per-iteration allocation assessment can satisfy that queue entry. It does not
qualify all host objects per run or replace native float differential evidence.
Latency reports require exact backend/output/counter checks, without inventing
a speed threshold. Any missing or unmet required entry fails the overall job.

Evidence and the disposable reference live outside the product checkout. The
reference manifest, complete reviewed patch and raw reference commit object are
retained. Product source is checked before/after each command and at finalization;
all installed workspace packages must resolve into this exact product checkout.
After the off comparison, a separate untimed process reruns the existing strict
reference parent/patch/dependency/cleanliness validator and retains its own report
and exit. A changed reference invalidates the off result while independent work continues.
The final artifact manifest hashes raw reports, traces, logs and the journal.
Always-run finalization records failed setup and interruption where the runner
remains available; upload retains both evidence and orchestration logs for30days.
A runner/VM loss can prevent finalization or upload, so GitHub job logs remain an
additional source and such an attempt cannot qualify. Permanent evidence archival
is a later byte-preserving review step.

Runner sidecars allowlist GitHub run/attempt/job/image fields; Node/runtime and
CPU inventory; effective parallelism; bounded cpuset, affinity, quota and
throttling files; load/pressure, CPU time and optional frequency/governor gauges.
Missing files remain marked unavailable. No token, complete environment or other
process command line is captured. These are before/after observations, not
continuous sampling, physical-CPU exclusivity or a guarantee of narrow intervals.
Hosted results may still be inconclusive, and every such result must be retained.
