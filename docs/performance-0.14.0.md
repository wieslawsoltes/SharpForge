# Runtime performance — 0.14.0

Measured in this Linux container on Node v22.16.0, same workload script and runner. These are local observations, not statistically qualified guarantees or comparisons against native .NET. Compile time is excluded. Each VM is created fresh; one warmup then four timed runs, median of the middle pair. Returned output is validated. Managed allocatedBytes excludes JavaScript maps, snapshots, worker heaps and WASM linear memory.

| Workload | Engine | 0.13 ms | 0.14 ms | Ratio (before/after) |
|---|---|---:|---:|---:|
| dictionary | source | 428.053 | 26.754 | 16.00× |
| dictionary | cil | 515.250 | 60.355 | 8.54× |
| list | source | 43.091 | 22.001 | 1.96× |
| list | cil | 226.909 | 179.359 | 1.27× |
| queue | source | 84.105 | 12.844 | 6.55× |
| queue | cil | 158.307 | 76.700 | 2.06× |
| builder | source | 14.910 | 12.738 | 1.17× |
| builder | cil | 41.116 | 40.649 | 1.01× |

Dictionary: 3,000 inserts plus lookups; List: 6,000 additions/indexed updates; Queue: 4,000 enqueue/dequeue; StringBuilder: 4,000 two-character appends. Workloads and reproduction are in `scripts/benchmark-release14.js` (`npm run bench:runtime`). The baseline was measured before implementation from the uploaded 0.13 source. All raw observations are retained in performance-before-0.13.0.json and performance-after-0.14.0.json.

Changes: resolve canonical ABI names without repeated generic regex parsing; directly dispatch the owning subsystem rather than probing every handler; cache property slots by record identity; in-place fixed-slot writes; maintain collection indexes on insert/update; queue ring buffer avoids shifting whole arrays. Tests verify snapshot restore/cache invalidation, managed limits, mutation observation and collection exceptions. No JIT or concurrent/compacting collector is claimed.

## SIMD and workers

`npm run bench:compute` records measured scalar and WASM implementations including input copies to linear memory and output arrays. It excludes managed compiler/VM instructions and native .NET comparisons. Warmup and iteration counts are in the JSON.

| 1,000,000 elements | Scalar ms | WASM ms |
|---|---:|---:|
| Int32Array add | 3.578 | 1.276 |
| Int32Array dot | 3.960 | 0.283 |
| Float64Array add | 4.907 | 3.288 |
| Float64Array dot | 4.655 | 1.271 |

Two-worker initialization took 35.680 ms; eight queued 100,000-element sum jobs then took 2.225 ms in this run. Both worker identities and peak active jobs were observed. This is not a promise of linear scaling. 4-element additions were slower through WASM in this run; the full data includes these cases. Pool startup, transfers, managed-array conversion and scheduling can dominate small jobs. Backends remain configurable, and fallback is explicit.

No physical WebGPU or native CLR performance qualification was performed. Machine load/JIT effects can materially change these timings. No timing threshold is asserted as a functional test.
