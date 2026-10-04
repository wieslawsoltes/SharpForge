The frozen method-header batch passed native correctness, reference-output compatibility, and the original 13-file gate (79/79). Four original benchmark processes then completed once each with exact source/tool pins unchanged. Performance acceptance remains pending: the corpus measured median increased 14.09%, p95 8.93%, and p99 10.27%. No sign-off or performance-pass claim is made.

Candidate: `3ddd6460260d93f0a5258bd84ac62158e36dce10` (product bytes unchanged from `3316898e`); baseline: `e60b0764782f1122439e5b161cb9494c75724e32`. Node 24.19.0, Linux x64, AMD EPYC 9V74, 9 reported logical CPUs, 10,451,464,192 bytes reported memory. The four runs occurred serially within the coordinated quiet window from 20:45:53 to 20:46:45 UTC on 2026-10-04.

| Workload / metric | Baseline | Candidate | Change |
|---|---:|---:|---:|
| controls / Import, ms (one sample) | 826.993373 | 635.955964 | -23.10% |
| controls / First compile, ms (one sample) | 70.645056 | 88.061377 | +24.65% |
| controls / median compile, ms | 4.863360 | 4.734440 | -2.65% |
| controls / mean compile, ms | 5.217843 | 4.805945 | -7.89% |
| controls / p95 compile, ms | 6.586586 | 5.768674 | -12.42% |
| controls / p99 compile, ms | 8.566827 | 7.216030 | -15.77% |
| controls / min compile, ms | 4.083289 | 4.011353 | -1.76% |
| controls / max compile, ms | 11.719438 | 8.189321 | -30.12% |
| corpus / Import, ms (one sample) | 607.424922 | 783.975562 | +29.07% |
| corpus / First compile, ms (one sample) | 134.679472 | 119.735855 | -11.10% |
| corpus / median compile, ms | 14.240625 | 16.246553 | +14.09% |
| corpus / mean compile, ms | 14.510691 | 16.692025 | +15.03% |
| corpus / p95 compile, ms | 17.621568 | 19.195050 | +8.93% |
| corpus / p99 compile, ms | 20.982805 | 23.137672 | +10.27% |
| corpus / min compile, ms | 12.653329 | 14.411863 | +13.90% |
| corpus / max compile, ms | 21.289757 | 24.122980 | +13.31% |

Each process retained 121 chronological compilations: first, 20 warmups, and 100 measured. The median is the middle-pair average; p95/p99 are nearest-rank samples 95/99. Compiler import is separate. Every compilation checks success and subsequent assembly-byte equality outside the timer. All 484 timing and heap observations remain in the original reports.

| Workload / measured heap delta | Baseline bytes | Candidate bytes | Change |
|---|---:|---:|---:|
| controls / median | 795,452.00 | 821,560.00 | +3.28% |
| controls / mean | 791,289.84 | 817,611.20 | +3.33% |
| controls / p95 | 818,320.00 | 847,000.00 | +3.50% |
| controls / p99 | 837,808.00 | 868,360.00 | +3.65% |
| controls / min | 571,456.00 | 578,904.00 | +1.30% |
| controls / max | 842,792.00 | 1,088,272.00 | +29.13% |
| corpus / median | 3,358,356.00 | 3,652,304.00 | +8.75% |
| corpus / mean | 3,362,602.72 | 3,656,973.76 | +8.75% |
| corpus / p95 | 3,387,768.00 | 3,680,144.00 | +8.63% |
| corpus / p99 | 3,592,328.00 | 3,693,944.00 | +2.83% |
| corpus / min | 3,148,176.00 | 3,621,480.00 | +15.03% |
| corpus / max | 3,637,760.00 | 4,013,672.00 | +10.33% |

GC was exposed and requested before each compile. Heap deltas include temporary objects; these figures are not allocation-rate, retained-heap, or peak-memory measurements. The corpus slowdown is present across all four chronological 25-sample quarters (baseline medians 14.184478, 14.152030, 14.987939, 13.441677 ms; candidate 16.265956, 16.539018, 15.762767, 16.337361 ms). Import and first-compile movement is mixed, and their single observations cannot establish a distribution.

The completed relaxed IL now receives a canonical, bounded graph analysis after eager emitter checks. This added per-method work is a plausible correctness cost, but the whole-checkout comparison does not isolate its causal contribution. The adverse corpus distribution requires explicit coordinator review under the project performance budget.

All three control methods and seven of thirteen corpus methods use tiny headers. Summed header bytes change from 36 to 3 and from 156 to 79 respectively; the complete PE files remain 1,536 and 2,560 bytes. All method IL hashes, local-signature tokens, code lengths and EH clauses match their baselines. The unchanged `Patterns` IL now has exact fat maxstack 3 instead of 5; `DeepCall` retains fat maxstack 10, and local/EH/dynamic-allocation methods retain fat initialization. All thirteen candidate corpus method observations match the retained native SRM record and complete maxstack analysis.

Correctness evidence includes four pinned probes plus seven native workload commands, Roslyn/compiler execution comparison, six valid ILAsm/body-writer boundaries, two native invalid-program cases, unchanged public/friend reference-output compatibility, and the 79/79 focused gate. The unchanged refout driver discards successful non-consumer subprocess output and deletes its temporary workspace; retained outer logs cannot recover that missing inner provenance.

Earlier evidence is preserved: the adapter test passed 1/1 while its original recorder failed to parse the Node spec reporter; three native attempts failed on observer/fixture issues (nil SRM token normalization, platform ILAsm arguments/local identifier, and ILAsm maxstack policy). Their original statuses, raw logs and source snapshots remain alongside corrected tool-only attempts. The earlier benchmark readiness failure and partial source archive remain unchanged. No benchmark cohort was retried.

Legacy emitter/replay integration and inherited schema qualification remain outside this batch; issue #2391 remains open. These results cover the recorded Linux/CoreCLR environment. Native success does not establish cross-platform qualification.

Exact invocation arguments, public environment settings, timing boundaries, raw output hashes and full distributions are in `method-header-qualification-review-3ddd6460.json`. The additive retention manifest maps every original evidence file to an exact repository-relative destination without modifying the originals.
