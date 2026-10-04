# Boolean final performance qualification review

**Decision: accept the final performance qualification at `af29812a6b0ca0184a79cc6bcddd01bf0a02fb6a` with the four explicit median exceptions below. Package and browser size decisions remain pending.**

Independent Codex agent review by `/root/review_insert_repeat`; this is not human review. Baseline: `af5450dacbdc2734432b13dffa63efb10eb93145`. Candidate tree: `d934a12e448fc825ad49a535ced67a801e98e57c`.

Runner SHA256: `ba0202edda201ad0755f16e4e30811c90e8b9b5027b940b08819b63ae207c14e`. Summary SHA256: `19102c57942c2d06f27e69c6d7a52fa316eac83a9746f57115a6b18ee5445e33`. Execution record SHA256: `1500a312ed278cb52be33377c7576086567ef59ae48f8dd28401377471e25b72`.

Independently read and hashed all 42 raw reports; validated sequential ABBA/new-case order, exit status, exact revision/runner/selector, 5000 iterations, 5 warmups, 9 retained samples, matching workload hashes and every managed counter; recomputed ten pooled median/p95 summaries and two new-cost summaries. No product execution.

## Row-by-row decisions

Times are milliseconds per 5,000 complete workload iterations. The cold literal cases directly initialize distinct strings; loop cases are full interpreted workloads.

| Engine / control | Median baseline → candidate | Median change | p95 baseline → candidate | p95 change | Decision |
|---|---:|---:|---:|---:|---|
| source / `literalCold` | 8.000348 → 11.427717 | +42.840234% | 21.599038 → 13.583818 | -37.109153% | accepted-exception |
| source / `literalLoop` | 19.279657 → 20.428899 | +5.960905% | 34.858019 → 28.291377 | -18.838254% | accepted-exception |
| source / `staticStringLoop` | 19.483108 → 20.378438 | +4.595417% | 37.509173 → 30.139647 | -19.647263% | accepted-within-median-budget |
| source / `readonlyScalarLoop` | 16.371295 → 16.952365 | +3.549316% | 33.775608 → 26.735570 | -20.843557% | accepted-within-median-budget |
| cil / `literalCold` | 12.050075 → 17.622537 | +46.244210% | 20.261697 → 28.946798 | +42.864628% | accepted-exception |
| cil / `literalLoop` | 110.086243 → 120.176011 | +9.165330% | 186.938404 → 205.785115 | +10.081776% | accepted-exception |
| cil / `staticStringLoop` | 139.969935 → 107.835983 | -22.957753% | 206.781078 → 157.120057 | -24.016231% | accepted-within-median-budget |
| cil / `readonlyScalarLoop` | 136.227886 → 123.946479 | -9.015340% | 173.664641 → 163.679816 | -5.749486% | accepted-within-median-budget |
| cil / `stringConstructorLoop` | 93.117883 → 90.529650 | -2.779523% | 160.925771 → 111.819074 | -30.515123% | accepted-within-median-budget |
| cil / `readonlyScalarFieldLoop` | 50.234841 → 49.591253 | -1.281159% | 69.714677 → 73.050985 | +4.785661% | accepted-within-median-budget |

All old-control managed allocations, allocated bytes, and collection counts are identical in every retained sample across revisions. Genuine CIL `readonlyScalarFieldLoop` has zero allocations/bytes/collections. Compiled `readonlyScalarLoop` separately covers source tagged constants and CIL `ldc.i8`.

**source / literalCold.** Accept the +3.427368 ms per 5000 distinct strings (+685.474 ns per initialization) correctness cost. Cold pending-operation tracking, bounded reentry, host snapshot/restore boundary, post-observer canonical recheck and stop checks prevent demonstrated publication/lifetime defects. These costs remain linear in initialized strings; managed allocation, bytes and collection counts are unchanged. The smaller candidate tail does not erase the median regression.

**source / literalLoop.** Accept the +1.149242 ms per 5000 complete loop iterations (+229.848 ns/iteration) exception. Warm hits now avoid transient pool/options construction; the necessary source CONST termination check remains, including numeric constants in the loop. No additional per-hit managed allocation or Map construction was added. This is a whole-batch loop delta, not a measured isolated cost of that check; the lower tail does not offset the median regression.

**source / staticStringLoop.** Accept within the 5% median budget (+4.595417%); candidate p95 is lower. No exception is required. Do not use this row to offset other regressions.

**source / readonlyScalarLoop.** Accept within the 5% median budget (+3.549316%); candidate p95 is lower. This is the source scalar-CONST control with zero managed allocations, not a field-allocation workload.

**cil / literalCold.** Accept both the +5.572462 ms median and +8.685101 ms observed p95 per 5000 distinct strings. Cold initialization retains the same pending/reentry/host-boundary/canonical-publication/stop guarantees as source. Median cost is +1114.492 ns per initialization; all managed counters match. The p95 increase of 42.864628% is adverse evidence and is explicitly included in this acceptance, not dismissed as noise or explained by unchanged managed GC counts.

**cil / literalLoop.** Accept both the +10.0897675 ms median and +18.846711 ms observed p95 per 5000 full interpreted iterations. The ldstr post-call state guard prevents a stopped allocating instruction from pushing into retired caller storage; warm lookup already uses the shared direct heap/map fast path. No pending-map work or pool-wrapper allocation occurs on warm hits. The measured +2017.954 ns/iteration is the whole interpreter-loop delta, not an isolated guard cost. Attribution to particular checks/JIT behavior remains unresolved; no further concrete safe simplification was found.

**cil / staticStringLoop.** Accept within budget; measured median and p95 are lower for this cohort. This is an individual observation, not evidence of a general speedup and not a credit against other rows.

**cil / readonlyScalarLoop.** Accept within budget; this compiled control executes ldc.i8, not external ldsfld. Lower measured median/p95 are not a credit against other rows.

**cil / stringConstructorLoop.** Accept within budget; median -2.779523% and lower p95. One empty char array and one cold empty string remain the only two allocations. This control does not measure nonempty UTF-16 copying.

**cil / readonlyScalarFieldLoop.** Accept median within budget (-1.281159%) and explicitly accept the observed tail increase of +3.336308 ms (+4.785661%) per 5000 genuine field-load loop iterations. This independent ldsfld control initializes one numeric static slot and then reuses it without managed allocation. Tail movement remains reported; it is not called noise.

## New Boolean-field costs

These are separate candidate-only costs, including first field initialization and subsequent warm reads; they are not baseline comparisons.

| Engine | Median | Observed p95 | Allocations / bytes / collections |
|---|---:|---:|---:|
| source | 23.890973 ms | 31.434995 ms | 2 / 70 / 0 |
| cil | 121.243846 ms | 178.332950 ms | 2 / 70 / 0 |

## Limits and remaining qualification

- Initial bcd18820 cohort remains rejected and retained; final acceptance applies only to af29812a with final ba0202ed runner and its own ABBA baseline.
- No average-offset or general-speedup claim. Full-loop movement is not statistically isolated overhead of one check; allocation counters cover managed heap only, not host JavaScript allocations.
- Five excluded warmups and nine samples per process, 18 pooled per revision per old control. Nearest-rank p95 at n=18 is the largest retained observation, not a precise population tail estimate.
- Benchmarks ran serially under the root owner on a shared Linux x64 AMD EPYC 9V74 host with Node v24.19.0; no claim of exclusive machine isolation.
- Cold literal rows are direct VM API calls; other rows include interpreter work and first initialization. Setup/compilation/admission/explicit host GC/checks are excluded; automatic managed GC is included.
- No main-thread latency guarantee, no cross-platform/Rust/Wasm execution or A00/schema approval implied.
- No further tuning or repeated sampling recommended absent a concrete new defect.

The initial rejected cohort, all final ABBA reports, and both new-operation reports must remain retained. No tests, builds, package installation, benchmarks, native captures, or product edits were performed by this reviewer.
