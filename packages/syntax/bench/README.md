# Syntax benchmark qualification

Run the complete parse workload and keep its JSON capture:

```sh
node scripts/limited.js node --expose-gc packages/syntax/bench/parse.bench.js --check --output artifacts/results/performance/syntax/parse.json
```

The benchmark covers the committed small, one-megabyte and ten-megabyte documents,
huge literals, interpolation, array initializers, comments and a long binary
expression. Every case is checked against `parse.baseline.json`; a calibrated
latency increase **greater than 15 percent** fails, including small absolute
increases. The preceding comparator ignored increases of two milliseconds or
less; the gate now applies the stated percentage budget to every case.

Missing or additional cases, changed input sizes, nonfinite numbers and absent
GC-backed heap measurements also fail. A qualification run cannot combine
`--check` with `--quick` or `--update`. Baseline updates are a separate reviewable
operation, never an automatic response to a failed check.

The JSON capture is written on a failed regression check as well as on success.
It includes the exact baseline SHA-256, verdict, source commit and tracked
changes, Node/V8 versions, platform/architecture, CPU and memory information, and
raw timing samples. Set `SHARPFORGE_BENCH_HOST_CONTEXT` to describe a shared host
when capturing results. A source commit with tracked changes is not evidence for
the clean committed tree. Calibration reduces some host speed differences; it
does not establish that two operating systems or processor architectures have
identical performance characteristics.

`parseMs` is the median of the retained samples. `firstParseMs` is the first
sample of that case; no warmups are performed. The reported p95/p99 are empirical
percentiles of those samples: three by default, and one for the ten-megabyte case.
They describe the capture and do not establish stable tail-latency estimates.

Memory measurements have separate meanings:

- `retainedHeapMB` is live V8 heap growth after explicit GC while the result is
  retained.
- `peakHeapMB` preserves the historical field name and measures the largest
  heap-growth sample immediately after a synchronous parse. It cannot observe
  the unsampled peak inside that parse.
- `processPeakRssMB` is the process lifetime maximum resident set, including the
  input corpus, runtime and benchmark harness. Node reports `maxRSS` in KiB;
  the artifact converts it to MiB on every platform.

Heap fields are `null` without `--expose-gc`; allocation counts are not measured.
The historical committed baseline was captured with Node 24.21.0 on macOS arm64.
Keep failures on other hosts as observed outcomes until a source regression or a
baseline portability difference has been established.
