# Automated performance disposition: maxstack and method headers

**Decision: accept every quantified adverse observation as an explicit correctness-cost exception under CONTRIBUTING section 4.** This is the task coordinator’s automated reviewer sign-off. Performance remains above the ordinary 5% regression budget; no human approval is represented.

Reviewed 2026-10-04T21:05:08.121715+00:00. Candidate `3ddd6460260d93f0a5258bd84ac62158e36dce10`, product `3316898efee4a9d23b8e0cb87919b9de28a1084a`, baseline `e60b0764782f1122439e5b161cb9494c75724e32`.

## Cost accepted

| Workload | Baseline median / p95 / p99, ms | Candidate median / p95 / p99, ms | Change, % |
|---|---:|---:|---:|
| controls | 4.863360 / 6.586586 / 8.566827 | 4.734440 / 5.768674 / 7.216030 | -2.6508 / -12.4178 / -15.7678 |
| corpus | 14.240625 / 17.621568 / 20.982805 | 16.246553 / 19.195050 / 23.137672 | +14.0860 / +8.9293 / +10.2697 |

The corpus median cost is **2.005928 ms (+14.0860%)** per complete compilation. Its p95 rises **8.9293%**, p99 **10.2697%**, mean **15.0326%**, minimum **13.8978%** and maximum **13.3079%**. Every chronological 25-sample quarter also has a higher candidate corpus median. These are accepted regressions, not a performance threshold pass.

Other adverse latency observations are the controls first compilation, **70.645056→88.061377 ms (+24.6533%)**, and corpus compiler import, **607.424922→783.975562 ms (+29.0654%)**. Each is one observation. The favorable controls steady distribution does not offset the adverse corpus or single-observation costs.

## Memory observations

| Workload | Statistic | Baseline bytes | Candidate bytes | Change |
|---|---|---:|---:|---:|
| controls | median | 795,452.00 | 821,560.00 | +3.2822% |
| controls | mean | 791,289.84 | 817,611.20 | +3.3264% |
| controls | p95 | 818,320.00 | 847,000.00 | +3.5047% |
| controls | p99 | 837,808.00 | 868,360.00 | +3.6467% |
| controls | min | 571,456.00 | 578,904.00 | +1.3033% |
| controls | max | 842,792.00 | 1,088,272.00 | +29.1270% |
| corpus | median | 3,358,356.00 | 3,652,304.00 | +8.7527% |
| corpus | mean | 3,362,602.72 | 3,656,973.76 | +8.7543% |
| corpus | p95 | 3,387,768.00 | 3,680,144.00 | +8.6303% |
| corpus | p99 | 3,592,328.00 | 3,693,944.00 | +2.8287% |
| corpus | min | 3,148,176.00 | 3,621,480.00 | +15.0342% |
| corpus | max | 3,637,760.00 | 4,013,672.00 | +10.3336% |

All twelve adverse heap observations above are explicitly included in this disposition. GC was exposed and requested before each compilation. These temporary-inclusive heap deltas do not measure allocation rate, retained heap or peak RSS. No causal GC or shared-host explanation is used to dismiss the measured regression.

## Why this correctness cost is accepted

The completed, branch-relaxed IL now receives canonical instruction decoding, exception-region/control-flow validation and a bounded dataflow computation before its maxstack is written. Eager emitter checks alone cannot prove the final instruction stream after later insertion and layout. The implementation reuses the existing fixed stack-effect, prefix grouping, EH and worklist authorities. Source inspection identifies concrete additional per-method work; the whole-checkout experiment does not isolate a causal cost for any one helper.

Tiny-header selection is explicit, and exact fat maxstack is retained when required by code size, locals, depth, handlers or dynamic-allocation/initialization policy. The omitted low-level header policy retains legacy fat bytes. Native observations and the focused gate verify the 63/64-byte boundary, implicit tiny maxstack 8, depth 8/9 distinction, explicit fat zero and malformed stack rejection.

The four benchmark reports preserve identical method IL hashes, code lengths, local-signature tokens and EH clauses across variants. Three control and seven corpus methods use tiny headers; summed header bytes change 36→3 and 156→79. The complete PE files remain 1,536 and 2,560 bytes. The unchanged `Patterns` IL has final-graph fat maxstack 3, previously 5; `DeepCall` remains fat at 10. No complete-file size reduction is claimed.

The recorded native, public/friend reference-output compatibility and original 13-file focused gate passed; the gate is 79/79. This supports accepting the additional computation needed to qualify the final method body. Historical failed native/recorder attempts remain unchanged; the benchmark protocol itself was never retried.

## Protocol and evidence

Four original serial processes ran in the coordinated quiet window on shared Linux x64, Node v24.19.0, AMD EPYC 9V74, with nine logical CPUs reported. Each process retains one first compilation, 20 warmups and 100 measured compilations: 484 total and 400 measured observations. Medians average the middle pair; p95/p99 use nearest rank. Imports are separate, and assembly determinism checks are outside timing.

The native SRM filter representation and product EH union fields are retained in their original forms. The independent cross-check normalizes only the documented filter-offset representation. Successful non-consumer inner stdout and deleted temporary workspaces in the unchanged refout driver cannot be recovered from outer logs; that provenance limit remains explicit.

Broader engine/OS qualification, legacy emitter/replay integration and inherited schema acceptance remain pending. Tracking issue #2391 remains open.

Independent qualification review SHA-256: `5552ed65e951c208b9d223efeae662e2b38fd39a4eb36a2d97a44a0b5d2d960c`.
Root review SHA-256: `5aa07113fd4d14c57755d6405dc7cf97837be6001715a1774749300793640d1e`.
The JSON root review includes every exact report hash, full distribution, quarter medians, single observations, heap comparisons and method facts. No product, native, test or benchmark execution occurred during this review.
