# Source admission reuse evidence at ef375

The four-file correctness cohort passed **39/39 tests, zero failures and zero
skips**. The independent Fibonacci100 measurement remains **inconclusive**:
**1.605549272945154×** against a **1.5×** target, with 95% paired-bootstrap
interval **[1.4364472786404399, 1.7696360228862134]**. The interval crosses the
target. The correctness command exited **0**; the benchmark exited **2**.
The correctness pass does not turn the performance result into a pass.

Both commands tested exact clean commit
`ef37516ecc3c47fcf34800af3220671eabc7a5eb`, tree
`d5b74f47247d40e89cc6e7711c737a22d035b7cc`. Each execution journal reports that
same clean identity at start and end, and the measurement report independently
records the same completed commit. The archive itself is not a tested product
revision.

## Focused correctness

The [original TAP](source-admission-reuse.log) and
[execution record](source-admission-reuse-execution.json) cover:

- `tests/a05-source-admission-reuse.test.js`
- `tests/a05-source-stack-byte-budget.test.js`
- `tests/a05-source-prepared-calls.test.js`
- `tests/a05-source-fusion-integer-plans.test.js`

Reported test duration was **4,558.381664 ms**; wall time was
**4.729460121001466 s**. The raw log SHA-256 is
`3db1511ba21e1e7f70d7d17cdbeb36cca4e0458dd618c87c7ccb7a3d8dae0b7a`.
This focused cohort is not a completed full A05 run.

## Independent Fibonacci measurement

| Warm execution statistic | Baseline | Candidate |
|---|---:|---:|
| Median | 82.52635249999912 ms | 51.400697500000206 ms |
| p95 | 114.99300514999963 ms | 74.90600214999904 ms |
| Measured observations | 100 | 100 |
| Retained first / warmup observations | 1 / 3 | 1 / 3 |
| Guest instructions per execution | 262,697 | 262,697 |

The unchanged protocol is **100 samples, 3 warmups, ABI64, seed 12012 and 10,000
bootstrap resamples**, with a 900-second timeout. All 104 observations per mode
report verified output and equal guest work; the report has zero errors. Warm
summaries exclude the retained first execution and warmups. Command wall time
was **20.75799839299725 s**.

Baseline and candidate are options of the same ef375 product: source fusion
is false in the baseline and true in the candidate. No cross-revision speedup
is inferred from this observation. The earlier 4c75 run and other historical
results remain preserved, are not pooled with this run, and are not replaced
by a selected favorable result. No workload, sampling or target change is
made by this archive.

The [full measurement JSON](source-fibonacci-100.json),
[raw command output](source-fibonacci-100.log), and
[execution JSON](source-fibonacci-100-execution.json) retain all samples,
cold costs, options, counters, host gauges, confidence calculations, command
arguments and environment. Browser timing, native CLR throughput and Wasm
remain explicitly unqualified by this Node interpreter run. Host memory gauges
are not allocation totals.

## Provenance and limits

All five raw files are byte-identical copies of the supplied captures.
[manifest.json](manifest.json) records original paths, byte counts, SHA-256
hashes, exact Git trees, tested fixture/harness source blobs, and the reported
harness/environment/assembly identities. Both commands ran through the limiter
on Node v24.19.0 with one run slot, serial tests and a 512 MiB V8 cap; the
measurement used `--expose-gc` on runner `a05-linux-x64-node24`.

The original failed strict-structure record remains unchanged; its separate
line-wrap repair does not alter these observations. This evidence-only commit
changes no product or acceptance ledger. No tests, builds, benchmarks or
checkers were run while archiving.
