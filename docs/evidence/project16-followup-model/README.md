# Project16 preview ownership model evidence

These artifacts retain one serial matched capture pair executed by the root
integration reviewer on 2026-10-04. See [the interpretation and reviewer decision](../../project16-preview-performance.md).

| File | Origin and format |
|---|---|
| `baseline.json` | Unmodified generated `sharpforge-editor-latency` schema 1 report at `8d1be9c`; ten rows with ordered raw samples. |
| `candidate.json` | Unmodified generated report at `80dfe3f5`, with the same workload and schema. |
| `baseline.log`, `candidate.log` | Unmodified capture stdout/stderr logs. |
| `summary.json` | Unmodified root capture supervisor metadata: exact commands, source/tree identities, order, times and exit codes. |
| `comparator-source.txt` | Exact `scripts/check-editor-perf.js` bytes at the candidate; identical at the baseline. Snapshot only. |
| `comparator.json` | Generated pure comparator result using threshold `0.05`; `passed: false`. |
| `comparator.log` | Unmodified comparator output; process exited 1. |
| `analysis.json` | Derived schema 1 comparison: all rows' full-precision median/p95/p99 deltas, count checks, source/harness hashes and reviewer decision. |
| `manifest.json` | SHA-256 and byte lengths for every evidence file except the manifest itself. |

The long JSON arrays are generated evidence, not handwritten implementation.
They deliberately preserve order and full numeric precision. No observations are
trimmed, winsorized, averaged across distinct operations, or relabeled as passing.
The pure comparator's nonzero outcome is retained in `analysis.json` and the
interpretation document. The original two captures both exited 0 because their
correctness checks passed; those codes are not relative-performance verdicts.

Capture inputs were 1 KiB and 1 MiB deterministic ASCII sources. Each of five
operations per size has 101 retained warm observations, one separate cold result
and ten unretained warmup invocations. This is model-only evidence from one
ordered baseline/candidate pair on a shared host. It does not measure browser
latency, allocations, retained memory or causal cost of an isolated code change.
