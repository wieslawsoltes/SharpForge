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
