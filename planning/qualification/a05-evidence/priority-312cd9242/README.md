# Actual priority qualification on published 312cd9242

Product: `312cd9242a492ce6f03e7e034a51cc17669a7edf`; full tree `21dd929c4087bb7dc97fdd735d88ae36d1e76050`.
Profiler reference: `e5191e722647d6a37f034499c0e880765fed4dad`, exact parent product 312. The full reviewed patch and dependency/source manifests are retained in `profiler-reference.json`.

All three commands completed with no execution errors and clean start/end product provenance. The product verifier checked all 4,553 materialized tracked files before and after the batch; reference changes also match their recorded hashes afterward. No runtime edit, fixture change, threshold change, observation trimming or selective rerun occurred.

| Row | Point estimate | 95% interval | Required target | Decision |
| --- | ---: | --- | --- | --- |
| source-fibonacci | 1.497688x | [1.377574, 1.620207]x | >=1.5x speedup | inconclusive |
| virtual-cache | 2.206167x | [2.114788, 2.299521]x | >=3x speedup | missed |
| profiler-off-source-arith | 5.402815% | [4.230798, 7.641610]% | <1% overhead | missed |
| profiler-off-source-calls | 2.394491% | [-0.793949, 5.145290]% | <1% overhead | inconclusive |
| profiler-off-source-allocation | 2.913881% | [-2.386908, 10.014207]% | <1% overhead | inconclusive |
| profiler-off-cil-arith | -0.574745% | [-3.648095, 2.336679]% | <1% overhead | inconclusive |
| profiler-off-cil-calls | -0.736436% | [-3.026634, 2.954132]% | <1% overhead | inconclusive |
| profiler-off-cil-allocation | 1.246746% | [-0.374900, 4.583823]% | <1% overhead | inconclusive |

Fibonacci and virtual use 100 measured pairs, 3 warmup pairs and one initial execution per mode (104 retained observations per mode). Profiler uses 100 measured pairs, 10 warmup pairs and one initial execution per mode (111 retained observations per mode). ABI64, seed 12012, 10,000 bootstrap resamples, resource limits 1/1/512, and exposed host GC match the prespecified protocol. The report command fields retain the exact inner Node arguments; the external command plan records the resource wrapper.

All six required off rows completed; enabled-overhead rows were intentionally omitted under `--profiler-mode off`. Therefore the report’s broader off-plus-on `profilerCoverage.complete` is false, while `requiredOff.missing` and `requiredOff.omitted` are empty. The off acceptance is MISSED, with one confirmed miss and five inconclusive rows. This does not establish overall Project 7 completion or native/browser performance.

Exit statuses: Fibonacci 2 (inconclusive), virtual 1 (missed), reference generator 0, profiler 1 (missed). Each has a sibling exit JSON. Profiler elapsed wall interval was 18:40:17.642–18:50:04.027 UTC on 2026-10-04 (~586.385 seconds).

Priority measurements do not substitute for the remaining targets, root scans, final snapshot/float evidence, fairness, differentials or T12 two-run baseline. Product/reference checkouts stay frozen while the coordinator owns subsequent validation and optimization.
