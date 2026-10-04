# CIL execution budget and admission limits

## Original failure

The integrated replay at `43fa19c425700e1c4703190f100239c06dd97a75`
produced three `IL_EH_FLOW` issues with diagnostic `CILR0001`:

- Extension iterator, closure and chained extension properties.
- Local iterator with captured state and a finally block.
- The pinned `by-reference/ref-out-in-parameters-share-the-variable` fixture.

`canonical-consumer-first.log.gz` preserves the complete original 74,196-byte log
losslessly. Its uncompressed SHA-256 is
`7b57bbfc9e2bc9528980283cd5d93a35b83074fa3d2e862fde4fc277be116b9b`.
The original launcher manifest is `canonical-consumer-first.json`.
`eh-failures.json` retains the three complete phase/error observations, including
source and assembly hashes. Other failures in the full log remain independent.

## Cause and correction

The replay helper explicitly supplied `maxInstructions: 20_000_000` to the CIL VM.
The VM forwarded the same options to its inspector and verifier. The EH region
builder interprets `maxInstructions` as a static method-size bound and rejects
values above 1,000,000 with `CILR0001`, before evaluating the method's EH geometry.
A low runtime budget also limited static decoding, causing rejection before the
execution budget could be enforced.

The runtime-owned `execution/cil-admission.js` seam removes only the execution
`maxInstructions` option from an owned copy used for CIL inspection and admission.
Initial admission and later synchronous callback verification share that rule.
Every other option keeps its original value and identity. The execution budget,
direct CIL API contracts, verifier checks and static ceilings are unchanged.
An existing `AssemblyInspector` retains its identity and inspection settings.
The existing registered CIL member, type and callback profiles are untouched.

The seam makes one copy proportional to the option count at admission, and one
when callback verification adds a new method. It adds no work per executed
instruction. Performance has not been measured for this source checkpoint.

## Qualification

Both runs used the frozen clean source head
`bfe3cb1f1d8c2d70b4b59bb291587159502d9c00`, tree
`a3173612a1d509a30f777f0815e7a903ab622c9a`, Node 24.19.0 and the normal serial
limiter. All three DOTNET path variables were pinned in the retained launch
manifests. No new native capture was needed for these tests; existing retained
ILVerify flow observations were checked by the unchanged admission tests.

| Run | Passed | Failed | Skipped | Test duration | Wall duration |
| --- | ---: | ---: | ---: | ---: | ---: |
| Four focused files | 30 | 0 | 0 | 2.556390442 s | 2.725688335 s |
| Two original replay files | 1 | 6 | 0 | 2.324069076 s | 2.481136204 s |

All nine new admission-budget controls passed. They cover actual finally
execution, nested fault/catch execution through a selected method, budgets above
the verifier ceiling, a low execution budget, direct verifier bounds, malformed
EH rejection, cancellation, and late callback verification with both successful
and rejected admission. Existing shared source/CIL callback controls also passed.

Before and after each run, the launcher verified the same 2,309 materialized
tracked inputs against their Git blobs and SHA-256 hashes. It recorded the static
and literal import graphs (1,562 modules for the focused group; 1,559 for the
replay group), plus all differential fixture modules. The source snapshots,
graphs, HEAD, tree and clean status remained unchanged. The capture script is
retained as `capture.py`; complete before/after snapshots are losslessly gzipped.

The focused raw log SHA-256 is
`db12d67bf0dfdf1cde0027663aebd854a3b126ea9500b0f8a8ae276c5959b0a5`.
The replay raw log SHA-256 is
`f0635ad8bf6a93417473ff1b12322581fa29828d5c4673bc223a2437de5dbbe8`.
Both complete logs are retained as `focused.log.gz` and `replay.log.gz`.

## Original replay disposition

All seven original replay sources and their emitted PE hashes match the original
failure capture. The existing helper still supplies a 20,000,000-instruction
execution budget. Every `CILR0001` / `IL_EH_FLOW` issue is resolved in this replay.

| Original case | Observed result after the admission correction |
| --- | --- |
| By-reference/ref-out-in parameters | Passed: terminated with the unchanged Roslyn-pinned output. |
| Extension iterator/closure/chained properties | Still fails admission: enumerable/enumerator interface members, IDisposable.Dispose and Environment.get_CurrentManagedThreadId are not implemented. |
| Local iterator with captured state and finally | Still fails admission for the same interface/thread-ID members. |
| Source Shape and Button | Still faults during execution: field declaring type does not match receiver. |
| Generic List<T>.Count extension property | Still fails admission for List<!!0>.get_Count. |
| Tuple deconstruction | Still fails admission for external ValueTuple fields and its constructor. |
| Nested object initializer | Still faults during execution: call receiver has no matching declaring instance. |

`qualification-results.json` retains every complete new observation, the totals,
the original PE-identity comparison and the EH diagnostic comparison. The six
remaining failures are independent follow-up work and remain failures.

## Standalone publication qualification

The four commits were cherry-picked with provenance onto qualified main
`41ebd76987aa912659310d4015607f46110358ab`. The standalone publication source
checkpoint is `b0285acf9d21205870c7f45f7d8a2ee65f917f25`, tree
`192e3f938bdc7c68fe13190f8d3b8ac77d643369`.

The same four focused files passed **30/30**, with zero failures or skips:
2.353947751 seconds test duration and 2.504477308 seconds wall time. The before
and after checks retained the same clean head, tree, 2,299 materialized tracked
inputs and 1,543-module static/literal import graph. All three DOTNET variables
remained pinned. `publication-focused-run.json` records the exact command and
environment. The raw log SHA-256 is
`dd7c4d083d96ab398306969c2291930e2af3583bd855d67f83b8c069fbb27783`.

The seven canonical/direct replay outcomes above belong to the original
integration source. They are not claimed as a new replay of the standalone
publication tree.

## Standalone performance comparison

The reviewed comparison ran once against the no-fix publication parent. All
eight serial processes completed in 6.707739147 seconds wall time. Each side
contributed 48 measured samples per workload after the unchanged 80-warmup,
24-sample-per-process policy, in A/B/B/A order. Every timing and managed allocation
measurement passed the finite, numeric and nonnegative guards. Every execution
matched its expected result, and the callback retained fresh verification,
authentic stack proofs, paused caller state and scope cleanup.

| Workload / phase | Baseline median ms | Candidate median ms | Median change | Baseline p95 ms | Candidate p95 ms | p95 change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary admission | 0.403859 | 0.536026 | +32.73% | 0.726447 | 0.884559 | +21.77% |
| Ordinary execution | 1.642366 | 2.290307 | +39.45% | 2.963081 | 3.108795 | +4.92% |
| Ordinary total | 2.107520 | 2.994504 | +42.09% | 3.510575 | 3.759901 | +7.10% |
| Callback fixture admission | 0.265540 | 0.294342 | +10.85% | 0.493825 | 0.544900 | +10.34% |
| Fresh callback invocation | 0.380059 | 0.418234 | +10.04% | 0.706778 | 0.761408 | +7.73% |
| Callback fixture total | 0.666108 | 0.709577 | +6.53% | 1.511980 | 1.283525 | -15.11% |

Both workloads retained identical PE hashes on both sides, and both reported
zero managed heap allocations and allocated bytes. Those heap counters do not
measure JavaScript option-copy allocations. Exported runtime source bytes grew
from 2,800,260 to 2,800,894; this is a source inventory, not a build-size result.

The single shared-host run exceeds the timing budget. Per-process ordinary
total medians were A1 2.143537 ms, B1 1.997263 ms, B2 3.184295 ms and A2 2.057435 ms.
The execution phase also varies substantially. This evidence does not establish
a stable regression estimate or isolate the cause of the change. No automatic
repeat was performed. Timing-budget disposition awaits explicit review.

`publication-performance.json.gz` retains the complete 413,374-byte raw report,
including every sample, child stdout/stderr, per-process summaries and exact
Git-export inventories. Its uncompressed SHA-256 is
`7e7a32902de801c6fa743c161d28479b6fd740739755581d507411c7c0014ba3`.
`publication-performance-review.json` lists all ten timing threshold breaches.
The launcher records unchanged worktree, source, graph and reviewed packet
hashes before/after execution. The temporary exports were removed afterward.
`performance-tools/` preserves the exact reviewed source packet; its preparation
status predates the completed run recorded here.
