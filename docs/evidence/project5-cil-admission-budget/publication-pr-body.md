## Problem

When a host supplies `maxInstructions: 20_000_000` to `CilVirtualMachine`, that
execution budget is also forwarded to PE decoding and CIL verification. The EH
verifier interprets the same option as a static method-size bound and rejects
values above 1,000,000. Valid programs with exception regions therefore fail
admission with `IL_EH_FLOW / CILR0001`. A small execution budget can instead stop
static decoding before the VM gets to enforce the budget during execution.

Late synchronous callback verification has the same option collision.

## Change

Add a runtime-owned admission seam that takes an owned copy of the launch options
and omits only the runtime execution `maxInstructions`. Initial PE inspection
and verification share that projected configuration. Callback verification uses
the same projection while retaining its original entry and additional method
roots.

The VM retains the caller's execution budget. Direct `AssemblyInspector` and
`verifyCilAssembly` callers retain their existing static `maxInstructions`
contract. All verifier ceilings, EH placement/transfer checks, authentic stack
proofs, region limits, cancellation, registered external identities and callback
profiles remain in effect. Existing inspector identity and other admission
option values are preserved.

The new internal seam is 16 lines. The legacy CIL VM module shrinks, and there
are no new runtime dependencies or package-entry exports. The runtime README
documents the distinct instruction limits.

## Branch provenance

This standalone branch is based on qualified main
`41ebd76987aa912659310d4015607f46110358ab`. It contains four cherry-picks with
original-commit provenance: failing evidence and controls, the admission seam,
the boundary hooks, and qualification evidence. A follow-up commit records the
standalone replay and performance results. It does not require the larger
canonical compiler/consumer branch.

Publication source checkpoint:
`b0285acf9d21205870c7f45f7d8a2ee65f917f25`.

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

The following four files passed **30/30 with zero failures or skips** on the
publication source checkpoint, independently of the original integration run:

```sh
node scripts/limited.js node --test --test-concurrency=1 \
  tests/a05-cil-admission-budget.test.js \
  tests/a03-07-eh-admission.test.js \
  tests/a05-callback-verification.test.js \
  tests/a05-synchronous-callbacks.test.js
```

Test duration was 2.353947751 seconds; wall duration was 2.504477308 seconds.
Before/after checks retained the same clean head, tree, 2,299 tracked inputs and
1,543-module static/literal import graph. All three DOTNET path variables were
pinned. The exact command, complete log and source snapshots are retained in
the evidence directory.

Publication log SHA-256:
`dd7c4d083d96ab398306969c2291930e2af3583bd855d67f83b8c069fbb27783`.

## Performance

The single reviewed comparison used the publication checkpoint against its
no-fix main parent. It reused the unchanged ordinary constructor workload and
existing async benchmark export/capture/summary helpers, and added one fresh,
previously unverified EH callback workload. Both versions used the same default
20,000,000 execution budget and identical benchmark/PE inputs.

The fixed schedule was A/B/B/A with 80 warmups and 24 recorded samples per process:
48 observations per side per workload, eight serial Node processes total.
All eight processes completed successfully in 6.707739147 seconds wall time.
Every raw and summarized measurement passed the numeric, finite and nonnegative
guards. Complete raw samples, per-process output and exact Git-export inventories
are retained.

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

**Timing-budget disposition: explicit review/sign-off pending.**

## Scope and merge readiness

This batch fixes runtime admission configuration. The broader canonical CIL and
runtime feature qualification remains open; the six retained downstream
failures are separate follow-up work. No project leaf is closed by this change.

Publication-tree replay and the bounded performance measurement are complete.
Timing-budget sign-off and the required `core` check remain pending. The earlier
replay totals above remain evidence for their original source checkpoint.
