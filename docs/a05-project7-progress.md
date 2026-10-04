# Project 7 integration progress — 2026-10-04

The retained A05 execution and performance branches are integrated with main
`5fc1286d7957c6e855e584c04eabbf8a2ba942b2`. The original 83-issue, 210-criterion
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
record each exact revision, cohort, result and digest. The most recent correctness
cohort at `5909d54f` passed all 28 checks. The preceding eight-file cohort at
`d9453a97` passed 40 checks with no failures and seven existing reference-pack
dependent skips. These selected cohorts overlap; they are not a new full-suite
result. Final full A05/byref-stress and repository gates remain pending.

## Measured optimization status

| Target | Exact measured revision | Observed result | Decision |
| --- | --- | --- | --- |
| Scalar slot time per guest instruction | `48c62243`, 100 pairs | 71.686% reduction; 95% CI 70.380–72.616% | Meets 30% at that revision |
| Virtual-call cache | `48c62243`, 20 pairs | 2.153884x; 95% CI 1.835978–2.521246x | Misses 3x; optimization continues |
| Source Fibonacci | `48c62243`, prespecified 100-pair repeat | 1.472784x; 95% CI 1.413465–1.523999x | Inconclusive against 1.5x |

Raw scalar/virtual reports are retained [here](a05-evidence/slots-virtual-48c62243/README.md).
Both Fibonacci runs are retained [here](a05-evidence/source-fibonacci-2026-10-04/README.md);
the larger run is not selected as a passing result. The unchanged workloads check
every output and guest instruction count. Warm managed/frame/storage allocation
counters remain zero in these reports. These exact counters do not measure every
host JavaScript allocation. Profiling points to prepared frame admission and
scrubbing as further work; a diagnostic CPU profile is not a speedup measurement.

The latest prior integer-loop, Int32 and small-long measurements met their stated
targets at their recorded revisions. Final roots, profiler-off overhead, full-size
array fairness, host snapshot retention, numeric differentials and repeated full
benchmark/startup/gate reports are still required. The float-allocation reports
distinguish bounded run cost from per-iteration allocation; they do not claim that
all host allocation is zero.

## Platform qualification

Focused PR workflows now define 31 independent native cases across SDK8 and SDK10
on Linux, Windows and macOS, and actual Chromium/Firefox/WebKit Wasm, CSP, debugger
and official Speedscope UI checks on Ubuntu. Reports retain exact checkout/tree,
SDK selection, workflow provenance and per-case outcomes. Their local runner and
contract tests passed, but no new native or browser matrix pass is recorded here.
Unsupported SDK policies and missing tools are explicit, separate outcomes.

The current PR remains a draft while the remaining targets and platform evidence
are completed. Historical retained branches remain available. No main merge or
blanket Project7 completion is represented by this checkpoint.
