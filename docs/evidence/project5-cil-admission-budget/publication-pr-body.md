## Problem

When a host supplies `maxInstructions: 20_000_000` to `CilVirtualMachine`, that
execution budget is also forwarded to PE decoding and CIL verification. The EH
verifier interprets the same option as a static method-size bound and rejects
values above 1,000,000. Valid programs with exception regions therefore fail
admission with `IL_EH_FLOW / CILR0001`. A small execution budget can instead stop
static decoding before the VM gets to enforce the budget during execution.

Late synchronous callback verification has the same option collision.

## Change

Add a runtime-owned admission seam that receives normalized, runtime-owned
launch options. When an execution `maxInstructions` property is present, it
omits only that property from an owned copy. When it is absent, it reuses the
existing owned options object. Initial PE inspection and verification share that
configuration. Callback verification uses the same projection while retaining
its original entry and additional method roots.

The VM retains the caller's execution budget. Direct `AssemblyInspector` and
`verifyCilAssembly` callers retain their existing static `maxInstructions`
contract. All verifier ceilings, EH placement/transfer checks, authentic stack
proofs, region limits, cancellation, registered external identities and callback
profiles remain in effect. Existing inspector identity and other admission
option values are preserved.

The new internal seam is 17 lines. The legacy CIL VM module shrinks, and there
are no new runtime dependencies or package-entry exports. The runtime README
documents the distinct instruction limits.

## Branch provenance

This standalone branch is based on qualified main
`41ebd76987aa912659310d4015607f46110358ab`. It contains four cherry-picks with
original-commit provenance: failing evidence and controls, the admission seam,
the boundary hooks, and qualification evidence. Follow-up commits record the
standalone replay, both performance comparisons and the owned-options fast path.
The fast path has its own production commit. This branch does not require the
larger canonical compiler/consumer branch.

Optimized publication source checkpoint:
`6f8da343a3df1105e7789e5a7201dd3ae4983855`.
The first standalone measurements below belong to source checkpoint
`b0285acf9d21205870c7f45f7d8a2ee65f917f25` and remain separately retained.

## Completed qualification on the original integration source

The following measurements belong to original source checkpoint
`bfe3cb1f1d8c2d70b4b59bb291587159502d9c00`, before the standalone branch was
prepared:

| Run | Passed | Failed | Skipped | Test duration |
| --- | ---: | ---: | ---: | ---: |
| Four focused admission/callback files | 30 | 0 | 0 | 2.556390442 s |
| Two original canonical/direct replay files | 1 | 6 | 0 | 2.324069076 s |

All nine new controls passed: finally and nested fault/catch execution, large
execution budgets, low-budget exhaustion during execution, unchanged direct
verifier bounds, malformed EH rejection, cancellation and successful/rejected
late callback admission. The unchanged shared source/CIL callback controls also
passed.

The original by-reference/ref-out/in fixture now terminates with its unchanged
Roslyn-pinned output. All seven replay sources and emitted PE hashes match the
original failure capture. The three original `CILR0001 / IL_EH_FLOW` failures are
resolved. Six independent failures remain explicitly recorded: two iterator
interface/thread-ID admission gaps, generic `List<!!0>.Count`, ValueTuple
fields/constructor admission, and the field/call receiver identity failures.

These runs used the normal serial limiter, Node 24.19.0 and all three pinned
DOTNET path variables. The frozen head, tree, clean status, 2,309 materialized
tracked inputs and static import graphs were unchanged before and after each
run. Complete raw logs, source inventories and per-case observations are in
`docs/evidence/project5-cil-admission-budget/`.

## Publication-tree qualification

The following four files passed **30/30 with zero failures or skips** on both
standalone source checkpoints, independently of the original integration run:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a05-cil-admission-budget.test.js \
  tests/a03-07-eh-admission.test.js \
  tests/a05-callback-verification.test.js \
  tests/a05-synchronous-callbacks.test.js
```

| Standalone source | Tests | Test duration | Wall duration | Tracked inputs | Import graph |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial `b0285acf9` | 30/30 | 2.353947751 s | 2.504477308 s | 2,299 | 1,543 |
| Optimized `6f8da343` | 30/30 | 2.681576129 s | 2.871636007 s | 2,313 | 1,543 |

Before/after checks retained each clean head, tree, tracked source inventory and
static/literal import graph. The optimized inventory also includes the earlier
committed evidence. All three DOTNET path variables were pinned. The exact
commands, complete logs and source snapshots are retained separately.

Initial publication log SHA-256:
`dd7c4d083d96ab398306969c2291930e2af3583bd855d67f83b8c069fbb27783`.
Optimized publication log SHA-256:
`42225f99722c7bdfd39d12aaab8f260ddf4137e3fcadb69f216edd2c49c3b016`.

## Performance

The reviewed protocol compares each standalone checkpoint with the same no-fix
main parent. It reuses the unchanged ordinary constructor workload and existing
async benchmark export/capture/summary helpers, with one fresh, previously
unverified EH callback workload. Both versions use the same default 20,000,000
execution budget and identical benchmark/PE inputs.

The fixed schedule was A/B/B/A with 80 warmups and 24 recorded samples per process:
48 observations per side per workload, eight serial Node processes total.
The shared host ran Linux x64 with Node 24.19.0 and reported nine CPUs. Every raw
and summarized measurement passed the numeric, finite and nonnegative guards.
Complete raw samples, per-process output and exact Git-export inventories are
retained for both comparisons.

### Initial standalone comparison

The first comparison measured `b0285acf9` once. All eight processes completed
successfully in 6.707739147 seconds wall time.

| Workload / phase | Baseline median ms | Candidate median ms | Median change | Baseline p95 ms | Candidate p95 ms | p95 change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary admission | 0.403859 | 0.536026 | +32.73% | 0.726447 | 0.884559 | +21.77% |
| Ordinary execution | 1.642366 | 2.290307 | +39.45% | 2.963081 | 3.108795 | +4.92% |
| Ordinary total | 2.107520 | 2.994504 | +42.09% | 3.510575 | 3.759901 | +7.10% |
| Callback fixture admission | 0.265540 | 0.294342 | +10.85% | 0.493825 | 0.544900 | +10.34% |
| Fresh callback invocation | 0.380059 | 0.418234 | +10.04% | 0.706778 | 0.761408 | +7.73% |
| Callback fixture total | 0.666108 | 0.709577 | +6.53% | 1.511980 | 1.283525 | -15.11% |

These measurements exceed the project's 5% timing budget. The recorded median
increases are 0.132168 ms for ordinary admission and 0.038175 ms for the fresh
callback; ordinary total increases by 0.886984 ms. Per-process ordinary total
medians were A1 2.143537 ms, B1 1.997263 ms, B2 3.184295 ms and A2 2.057435 ms.
The execution phase also varies substantially. This single shared-host run does
not establish a stable regression estimate or isolate option-copy causality.
No automatic repeat was performed.

Both workloads retained identical PE hashes across versions, with zero managed
heap allocations and allocated bytes. Those counters do not measure JavaScript
option-copy allocations. Exported runtime source bytes increased from 2,800,260
to 2,800,894; this is not a build-output size measurement.

The complete 413,374-byte performance report has SHA-256
`7e7a32902de801c6fa743c161d28479b6fd740739755581d507411c7c0014ba3`.
All ten timing threshold breaches are listed in the retained review JSON.

### Optimized standalone comparison

One approved follow-up measured `6f8da343` after removing the avoidable default
path projection copy. Both call sites already supply normalized, owned options;
the explicit execution-budget path keeps the original exclusion/copy behavior.
The helper, drivers, fixture and protocol remained byte-identical. This source
change justified the follow-up; no third run or further optimization was made.

All eight processes completed successfully in 7.244332911 seconds wall time.
The workload results, fresh callback verification, authentic stack proofs,
paused caller state and scope cleanup all passed. Worktree, graph and benchmark
packet hashes remained unchanged throughout capture.

| Workload / phase | Baseline median ms | Candidate median ms | Median change | Baseline p95 ms | Candidate p95 ms | p95 change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary admission | 0.458178 | 0.584459 | +27.56% | 0.812573 | 0.769451 | -5.31% |
| Ordinary execution | 1.819652 | 2.574436 | +41.48% | 3.828204 | 3.320828 | -13.25% |
| Ordinary total | 2.290733 | 3.121516 | +36.27% | 4.309738 | 4.093433 | -5.02% |
| Callback fixture admission | 0.272966 | 0.278995 | +2.21% | 0.536748 | 0.433146 | -19.30% |
| Fresh callback invocation | 0.377235 | 0.413433 | +9.60% | 0.846933 | 0.768880 | -9.22% |
| Callback fixture total | 0.677285 | 0.684676 | +1.09% | 1.757110 | 1.183749 | -32.63% |

**Four median measurements still exceed the 5% timing budget.** Ordinary
admission, execution and total increased by 0.126281 ms, 0.754784 ms and
0.830783 ms; fresh callback invocation increased by 0.036198 ms. All six p95
values decreased in this comparison. The original ten breaches remain recorded
without edits, and the two source checkpoints are not pooled. These measurements
do not establish a stable regression estimate or isolate option-copy causality.

Per-process ordinary total medians were A1 2.475051 ms, B1 3.068558 ms,
B2 3.121516 ms and A2 2.189754 ms. Fresh callback medians were A1 0.385587 ms,
B1 0.421905 ms, B2 0.394504 ms and A2 0.373464 ms. Load averages were
[2.748047, 2.810547, 2.196777] at the start and
[2.848633, 2.830566, 2.206543] at the end.

Both workloads retained identical PE hashes across versions. Managed heap
allocations and allocated bytes were again zero; these counters do not measure
JavaScript option-copy allocations. Exported runtime source bytes were 2,800,260
for the baseline and 2,800,972 for the optimized candidate. This is a source
inventory, not a build-output size measurement.

The complete 413,376-byte report has SHA-256
`3921e4b58e11e2c2f2d629f3d57361e1a75e65a3fd87be32588a5351b699c954`.
It is retained as `optimized-performance.json.gz`, with all four breaches in
`optimized-performance-review.json` and full launcher/source records beside it.
The unchanged reviewed drivers and protocol are retained in `performance-tools/`.

The follow-up ran this command through the source-guarded capture launcher,
with `DOTNET_ROOT`, `DOTNET` and `SHARPFORGE_ORACLE_DOTNET` pinned in its manifest:

```sh
node scripts/limited.js python3 \
  /workspace/scratch/1692a10afba9/cil-admission-budget-performance-proposal/paired.py \
  --repository /workspace/scratch/1692a10afba9/p5-cil-admission-budget \
  --baseline 41ebd76987aa912659310d4015607f46110358ab \
  --candidate 6f8da343a3df1105e7789e5a7201dd3ae4983855 \
  --output /workspace/scratch/1692a10afba9/cil-admission-budget-optimized-performance.json
```

**Timing-budget disposition: the observed budget remains exceeded; explicit
review/sign-off is pending.** The correctness need is to admit valid EH programs
at the requested runtime budget while retaining the direct static verifier
contract. The measured costs above are retained for that decision.

## Scope and merge readiness

This batch fixes runtime admission configuration. The broader canonical CIL and
runtime feature qualification remains open; the six retained downstream
failures are separate follow-up work. No project leaf is closed by this change.

Publication-tree replay and both bounded performance measurements are complete.
Timing-budget sign-off and the required `core` check remain pending. Earlier
replay totals above remain evidence for their original source checkpoints.
