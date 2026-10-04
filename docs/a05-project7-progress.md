# Project 7 integration progress — 2026-10-04

The retained A05 execution and performance branches are integrated with main
`19755847de71941a96ff4888d3b16402c966c401`. The original 83-issue, 210-criterion
[acceptance ledger](a05-project7-acceptance-audit.json) preserves the captured scope
and historical checkpoints. This progress note supersedes the audit's
`54e3bba84` repair-status checkpoint; it does not close issues.

## Implemented and checked since the audit checkpoint

The callback/root inventory, managed/framework Object callbacks, first-chance and
unhandled policy/replay, source generic interface receiver lowering, and CIL
execution-versus-admission budgets have focused passing repair runs. Structured
constructed source type identities now survive source serialization and stripped
CIL without changing physical storage/dispatch ownership. Actual CLI nested generic
types use their owned GenericParam count, including inherited outer parameters.

The exact Swap/out/in/ref-indexer example exposed and now covers a bound-lowering
defect. Assignments capture the returned address once and preserve receiver, index,
getter and right-hand-side order. Substituted generic struct boxing copies the
closed value into a distinct box. These cases pass source, reloaded-source and
direct-CIL routes. Runnable memory and exception-order examples also pass.

[Retained validation logs](a05-evidence/integration-validation-20261004/README.md)
record each exact revision, cohort, result and digest. The broad A05, preemption
and security run at `3b482d83b` completed 3,187 tests: 3,162 passed and 25 failed.
The failures exposed logical vararg stack sizing and heap-versus-assembly limit
handling, plus stale diagnostic and fixture expectations. Its raw failure log
and the first failed repair attempt remain preserved in the
[main reconciliation archive](a05-evidence/integration-validation-20261004/main349/README.md).

Subsequent vararg and opcode validation passed 73/73 at `e67391b4b`; affected
security boundaries passed 10/10 at `cc75e3a98`. Initial and callback CIL admission
now share structural-limit normalization; that focused cohort passed 24/24 at
`63f331913`. The repaired Nullable, metadata identity, callback fixture and
profiler-reference cases also passed within the earlier selected repair run.
The broad A05/preemption/security rerun at `5379d076a` then passed all 3,236
tests with zero failures or skips. Independent byref stress at that revision
passed all six cases, exercising 1,000 distinct CIL programs and 131,341
collections, with source/reloaded counterparts and negative root-removal controls.
The separate stored native numeric replay exposed seven compiler-admission
failures; its 100,000-pair helper table and floating/small-storage groups passed,
but the complete cross-engine replay remains open.

Main subsequently advanced to `19755847`; its reconciliation preserves all A05
and new CIL exports. There are no new runtime or bytecode changes in that main
delta. Its affected admission, delegate, async, native-plan, nullable and
reference-assembly selection passed 65/65 at `abc0b1f0ff`; separate allocation
assessment, browser-contract and native-provenance cases passed 18/18 there.
These selected cohorts overlap; their counts must not be added. Remaining
repository and affected platform gates are tracked independently.

## Measured optimization status

| Target | Exact measured revision | Observed result | Decision |
| --- | --- | --- | --- |
| Scalar slot time per guest instruction | `48c62243`, 100 pairs | 71.686% reduction; 95% CI 70.380–72.616% | Meets 30% at that revision |
| Virtual-call cache | `48c62243`, 20 pairs | 2.153884x; 95% CI 1.835978–2.521246x | Misses 3x; optimization continues |
| Source Fibonacci | `48c62243`, prespecified 100-pair repeat | 1.472784x; 95% CI 1.413465–1.523999x | Inconclusive against 1.5x |
| Source root scanning | `5909d54f`, 100 pairs | 3.397571x; 95% CI 3.326203–3.482088x | Meets 3x at that revision |
| CIL root scanning | `5909d54f`, 100 pairs | 3.343396x; 95% CI 3.253705–3.506038x | Meets 3x at that revision |

Raw scalar/virtual reports are retained [here](a05-evidence/slots-virtual-48c62243/README.md).
Both Fibonacci runs are retained [here](a05-evidence/source-fibonacci-2026-10-04/README.md);
the larger run is not selected as a passing result. The unchanged workloads check
every output and guest instruction count. Warm managed/frame/storage allocation
counters remain zero in these reports. These exact counters do not measure every
host JavaScript allocation. Profiling points to prepared frame admission and
scrubbing as further work; a diagnostic CPU profile is not a speedup measurement.

The latest prior integer-loop, Int32 and small-long measurements met their stated
targets at their recorded revisions. The strict profiling-off comparison at
`9344fe8cb` completed all 100 pairs per row but did not qualify: two required CIL
rows missed the 1% overhead threshold and four rows were inconclusive. The later
private profiler handles and prepared-frame changes need fresh measurements.
Final Fibonacci, virtual dispatch, warm-cache/pool counters, profiling-off
overhead, full-size fairness, numeric differentials and repeated full
benchmark/startup/gate reports remain open.

The original snapshot-retention workload at `5909d54f` completed 128 captures and
128 matching restores: history used 1.134337 times the managed heap and combined
live/history memory used 1.468457 times it. A supplemental distributed-byte
mutation workload exceeded its cap after 23 captures; it is not a passing result
or a universal memory guarantee. The float-allocation reports distinguish bounded
run cost from per-iteration allocation; they do not claim all host allocation is zero.

## Platform qualification

Focused PR workflows now define 32 independent native cases across SDK8 and SDK10
on Linux, Windows and macOS, and actual Chromium/Firefox/WebKit Wasm, CSP, debugger
and official Speedscope UI checks on Ubuntu. Reports retain exact checkout/tree,
SDK selection, workflow provenance and per-case outcomes. Their local runner and
contract tests passed, but no new native or browser matrix pass is recorded here.
Unsupported SDK policies and missing tools are explicit, separate outcomes.

The current PR remains a draft while the remaining targets and platform evidence
are completed. Historical retained branches remain available. No main merge or
blanket Project7 completion is represented by this checkpoint.

The two focused workflows also run on pushes to the exact owned continuation
branch. This enables actual head qualification while a moving main prevents a PR
merge checkout. Duplicate jobs for that same-repository PR are suppressed; other
SF-A05/full-ci PR gates and manual dispatch remain available. Push reports identify
the actual pushed commit and do not invent PR merge metadata.
