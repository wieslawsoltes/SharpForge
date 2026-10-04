# Source Fibonacci after integer-plan changes at 4c75

The selected Fibonacci target remains **inconclusive** at its required **1.5×**
speedup. The observed baseline/candidate ratio is **1.5856073920808873×**, with
95% paired-bootstrap interval **[1.4864772844986704, 1.6946718688141758]**.
The point estimate meets the target; the interval crosses it. The command
returned **exit 2**, with report status `measured` and acceptance `inconclusive`.
This archive does not relabel the result as passing.

The exact tested commit was `4c75ea43f5310e50594098076693d1582b49c7d3`, tree
`bdcb5c1429bd01e2992388b5ed95c56303d05e63`, clean at command start and end.
The report also records this same completed commit and clean worktree.
Baseline and candidate are two options of this one revision: `sourceFusion`
is false in the baseline and true in the candidate. This is not a comparison
against another historical revision or qualification of a later revision.

| Observation | Baseline | Candidate |
|---|---:|---:|
| Measured pairs | 100 | 100 |
| Median execution | 76.65023699999983 ms | 48.3412459999995 ms |
| p95 execution | 105.71982750000046 ms | 72.17321284999987 ms |
| Guest instructions per execution | 262,697 | 262,697 |
| Measured managed allocations | 0 | 0 |
| Measured frame / frame-array allocations | 0 / 0 | 0 / 0 |

Each mode retains one first execution and three warmups outside the measured
summary. All retained executions report verified output and equal guest work.
The protocol uses **100 measured pairs, 3 warmup pairs, ABI64, seed 12012,
10,000 bootstrap resamples and 95% confidence**, alternating pair order on
persistent prepared VMs. The 900-second timeout and original workload/threshold
are unchanged. Host memory fields are gauges, not allocation totals; the exact
managed/frame counters do not establish zero JavaScript allocation.

The command ran through the limiter with one run slot, serial test policy and
a 512 MiB V8 cap on Node **v24.19.0** / V8 **13.6.233.17-node.51**, Linux x64,
runner `a05-linux-x64-node24`. The report records the effective host environment,
GC exposure, heap-size limit, resource controls and CPU model. It began at
2026-10-04T22:31:45.867304+00:00 and completed at
2026-10-04T22:32:05.513154+00:00; wall time was **19.645507032997557 s**.
Cold construction and preparation are retained separately from warm timings.

- [Original measurement JSON](source-fibonacci-100.json) retains every sample,
  cold cost, VM option, host gauge, statistical result and unsupported target.
- [Original command output](source-fibonacci-100.log) retains the reported
  inconclusive status.
- [Original execution JSON](source-fibonacci-100-execution.json) retains exact
  ordered argv, resources, timestamps, exit and start/end identities.
- [Archive manifest](manifest.json) records original paths, byte counts, SHA-256
  hashes, tested Git trees, fixture/harness source blobs and the report's
  harness/environment/assembly identities.

The three raw files are byte-for-byte copies from
`/workspace/scratch/42f7738360b9/a05-priority-after-source-ops-4c75-20261004/`.
The original report explicitly does not qualify browser timing, native CLR
throughput or Wasm. Historical observations remain intact and are not pooled
with this run. No product or acceptance-ledger change, test, build or benchmark
was performed while preparing this evidence-only archive.
