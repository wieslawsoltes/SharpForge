# Project 7 criterion follow-up at 935a5b245

This additive review compares implementation at `935a5b245` with the preserved
`54e3bba842f5b03c3364ee8db9b4978eb05f71b5` checkpoint in
[`a05-project7-acceptance-audit.json`](a05-project7-acceptance-audit.json). It does
not replace the original 83-issue/210-criterion inventory, change issue states,
or count overlapping focused cohorts as a complete suite. Later changes and
results below identify their own revisions. Native, browser and final performance
qualification remain independent from static inspection and authored tests.

## Concrete implementation findings

| Original criterion | Finding at inspected revision | Follow-up |
| --- | --- | --- |
| #1363: recursion depth 10,000 succeeds by default; stack overflow is fatal and bypasses `catch(Exception)` | Both VM initializers still supplied `maxFrames: 512`; byte accounting was optional. The default-depth acceptance could not pass. | `6972cd6f0` and `4c9ce88f9` apply the shared 4 MiB logical byte budget and preserve explicit depth limits. The integration coordinator reported 112/112 focused passes at `c47260dfe`, including all 13 new policy cases and 10,000 recursive calls on all three routes. |
| #1363: byte admission remains authoritative after metadata shape changes | Cached method sizes and live-frame admission compared local/parameter array identities but missed in-place length growth. | `e750df215` adds length stamps and six exact quota-boundary/live-PC regressions. Execution of this follow-up was pending when this note was written. |

The independent control audit subsequently identified and authored a separate
#1362 unmanaged-vararg admission correction (`67d171967`) and exact #1358
virtual-delegate/protocol fixtures (`59b288020`). Those are owned by the control
workstream; their native SDK evidence must not be inferred from local IL tests.

## Counter qualifications that must remain explicit

These rows are separate from the already queued Fibonacci, virtual dispatch,
profiler overhead, fairness, numeric corpus, floating allocation, T12, native,
browser and full-suite runs.

| Issue and exact obligation | Existing mechanism/evidence | Required final evidence |
| --- | --- | --- |
| #1390: report cold decode cost and zero warm `Map` allocations; all CIL suites pass | `warm-call-plans` in `bench/vm/qualification-fixtures.js`; retained target report at `9ab4a805` | Repeat cold preparation and warm offset-map counters after final code changes. Complete CIL test results remain a separate obligation. |
| #1392: a warm field-heavy loop makes zero `inspector.resolveToken` calls | `warm-fields` measures actual inspector calls; retained report at `9ab4a805` | A final-revision measured counter row. Cache correctness tests alone do not provide the profile observation. |
| #1399: warm deep recursion allocates no per-call arrays, and collected live-object count returns to baseline | `frame-pool-source` and `frame-pool-cil` compare exact pool and post-collection counters; retained report at `9ab4a805` | Both recursion/retention rows after prepared-frame and default-stack changes. The 48c62243 Fibonacci counters and lifecycle tests are useful but do not replace this retention fixture. |

## Existing exact regressions, rather than new implementation gaps

| Issue | Concrete coverage found |
| --- | --- |
| #1360 | `tests/a05-02-tailcall.test.js` executes 1,000,000 tail calls with at most two frames and checks caller-local-byref fallback through an ordinary call. |
| #1356 | `a05-02-generic-calls` covers nested closed owners, independent type/method substitutions and `default(T)`/`typeof(T)`. `a05-nested-cli-generics` covers actual CLI inherited generic arity and closed field/call identities. The focused actual-CLI cohort at `5909d54f` passed 28 cases. |
| #1386 | `a05-06-coherent-snapshot` checks typed schema-version rejection and 24 randomized instruction boundaries with two deterministic replays for each source/CIL case. |
| #1403 | `a05-runtime-events` checks ordered subscription, oldest-entry drops and exact dropped counts. Separate source/CIL producer suites exercise actual guest method, exception, GC and tier events. |
| #1409 | `a05-11-wasm-runtime-bridge` executes real compiled field/array helpers against the interpreter, collecting at every instruction and comparing writes, allocations, collections and mutation revisions. |

These test definitions resolve ambiguity about missing fixtures. They still need
the affected final-revision and platform runs; their existence is not a passing
result. Source class inheritance and source function-pointer calls have explicit
profile exclusions, while the corresponding direct-CIL paths have their own
fixtures. An unsupported source construct must not be presented as a source pass.

## Delivery descriptions superseded since checkpoint 54

| Parent criteria | New delivery artifacts and evidence | Remaining distinction |
| --- | --- | --- |
| #74, #75, #80–#82: runnable example, API row and regression | `docs/a05-runtime-capabilities.md`; scalar, managed-reference and preparation/invalidation examples. Scalar routes passed at `45ca8e0a4`; managed-reference cases passed at `d9453a979`. | The old preparation example used unsupported class inheritance; `aa20c57ae` replaces it with interface calls. Source-proof and real-CALLVIRT follow-ups need their coordinated rerun. |
| #76 and #78: memory/array example and API row | `examples/runtime/rectangular-memory.mjs`, `managed-references.mjs`, and tables in `docs/source-memory-lowering.md`. Exact `Swap`/`out`/ref-indexer/`in` and memory examples passed at `d9453a979`. | That document's earlier “execution pending” wording is stale; replace it with revision-scoped results, not a current-platform completion claim. |
| #77: filter/cleanup example and API row | `examples/runtime/exception-order.mjs` and the table in `docs/runtime-a05-exception-hierarchy.md` cover filter-before-finally and throwing-filter cleanup. The example cohort passed at `d9453a979`. | Native trace comparison remains separate. Older callback-repair and pending-example wording must be reconciled with the actual focused logs. |
| #83: profiler/export API status | `exportRuntimeTrace` and `docs/runtime-trace-export.md` provide structured trace JSON. | `docs/profile-export.md` still describes trace JSON as absent. Binary `.nettrace` remains explicitly unsupported; real Speedscope import and measured overhead are separate gates. |

The focused validation manifest retains overlapping cohorts at `8cc82866`,
`7a088bfe`, `b70703e4`, `d9453a979` and `5909d54f`. The seven skipped cases in the
47-case `d9453a979` run require an unavailable .NET reference pack; the actual
source indexer test ran. Browser Python contract tests do not execute a browser,
and synthetic native-plan rejection tests do not execute a CLR.

## Measured results suitable for additive ledger entries

- **#1398 at `48c62243`:** 100 measured pairs show a 71.68599% scalar-slot time
  reduction, with a 95% interval of 70.38037–72.61628%, meeting the 30% threshold
  at that revision. The later default stack policy is not covered by this result.
- **#1387 at `5909d54f`:** the original record-mutation workload retains all 128
  snapshots and verifies all 128 full-copy comparisons. Snapshot-history/managed
  heap is 1.134337× and combined live/history is 1.468457×. The supplemental
  distributed-byte workload reaches only 23/128 snapshots before its cap and is
  not a pass. These different mutation workloads must retain their labels.

The checkpoint's raw observations remain valid history. A current assessment
should append implementation, focused-test and measured/platform statuses with
their exact provenance rather than overwriting the old checkpoint or promoting
all children together.
