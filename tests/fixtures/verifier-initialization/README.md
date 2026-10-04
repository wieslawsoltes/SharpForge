# Definite local initialization qualification

Qualified committed source `c99aa097d7ac79651220725e8753f36b0f0d34f7` (product `707f95d3e`), exact baseline `b79fbbb9e9b54cb77d2376765e290e9b0922b2d6`.
Driver session81637 completed every serial stage with exit0; no retries. The baseline regression failed with the intended store-before-read rejection before qualification.

- 34/34 focused tests, zero failures/skips, covering numeric/dataflow/lattice consumers.
- ILVerify10.0.5 / SDK10.0.201 / CoreCLR10.0.5: 24 observations match predeclared native expectations; 15 policy agreements and nine optional-analysis differences, **not 24 native parity passes**.
- Chromium153.0.8010.12, Firefox155.0 and WebKit26.6: 106 source-module checks per engine; servers/browsers closed.
- Syntax3625/static3621: zero errors; manifests30areas/982Node/37browser with no gaps or duplicates.
- Structure272 inherited findings, none in changed files; broader repository structure debt remains open.

The public default remains portable. Only explicit `localInitialization: 'definite-assignment'` uses ECMA III.1.8.1.1 optional analysis. ILVerify requires InitLocals on every local load/address and does not track prior stores. Those differences are permitted implementation choices, not oracle defects. Exact fixture PE/input/tool hashes and raw observations are in `native.json`. Constructor-this state, alias initialization, EH, byref lifetime and runtime execution integration remain OPEN under #2405/#52.

## Fixed performance observations

Apple M3 Pro, Darwin25.6, Node24.21.0, shared host; one team outer limiter with concurrency1/maxruns1/1024MiB. Commands and exact timings are retained in `qualification/driver-0.json` and `driver.mjs.txt`. Each cell has12 chronological samples; first3 are predesignated warmups, no discarded measurements or repeated runs. Heap deltas are process observations, not allocation counts or peak heap.

Existing typed numeric controls, milliseconds per1000 verifications:

| Control | Before median / p95 | After median / p95 |
|---|---:|---:|
| Add_0_0 | 1.756209 / 2.204791 | 1.676250 / 2.236792 |
| Diamond | 1.782500 / 2.164625 | 1.824000 / 2.370334 |
| MixedJoin | 11.562167 / 11.956083 | 11.762084 / 12.084458 |

**Explicit root reviewer sign-off:** accept Diamond p95 +9.5032%, or +0.205709microseconds per verification, for bounded typed state composition and the explicit local-initialization policy. Portable mode allocates no local bitsets. This is acceptance of the measured cost, not a noise/causality/speedup claim. No other existing median/p95 crossed5%. Independent Loader source review found no blocker.

New feature costs below are added capability, not comparable old-operation regressions. Cold includes a fresh AssemblyInspector; cached reuses one inspector.

| Case | Iterations | Median / p95 milliseconds |
|---|---:|---:|
| StoredLoad:cold | 100 | 2.549042 / 3.403750 |
| StoredLoad:cached | 1000 | 2.593709 / 3.520333 |
| DiamondBoth:cold | 100 | 2.542958 / 3.235959 |
| DiamondBoth:cached | 1000 | 3.194792 / 7.153666 |
| WordBoundaries:cold | 100 | 3.146625 / 6.104625 |
| WordBoundaries:cached | 1000 | 8.889167 / 9.602875 |

All144 raw samples (72 existing before/after,72 new cold/cached), heap observations, source/workspace proofs, browser reports and stage logs are committed under `qualification/`. The existing numeric benchmark and input are byte-identical on baseline/head. The source VM/direct-CIL/native/Wasm execution matrix is not claimed: this API verifies metadata/IL and does not execute it. Broad qualification remains staged until the whole relevant scope is complete.
