# Project 7 criterion audit checkpoint — 2026-10-04

The current additive reconciliation observes
`0d99a7aa00f0b8807411030f29e8582f2e5bdcc9`, tree
`82d6f5517ef5f2162d3cba9a6664b1cadc03fd15`. Its entry in the JSON ledger's
`historical_evidence_reconciliations` array preserves all preceding fields,
83 issues, 210 original criteria, body hashes and results. The
[progress document](a05-project7-progress.md#current-focused-correctness-checkpoint)
links the exact archives. This is a focused correctness checkpoint for the
existing draft PR, with performance work continuing; it closes no issue.

The failed `4c75` cohort remains **276/283 passed, seven failed**. Separate
repairs passed **89/89** debugger/admission tests at `3505`, **39/39** source
admission tests at `ef375`, and **12/12** conversion-retention/helper tests at
`e37a`. These selections overlap and are not added together. The last selection
does not establish actual native execution of the pending **2,277-case ABI32**
conversion matrix. The original 15-target wording is unchanged; eleven fixed
forms plus four native-width forms is the documented coverage interpretation,
not a claim about author intent.

At `2a9b`, ordinary static checking passed while strict structure checking
failed with **265** reported problems: **238** byte-identical main paths,
**26** changed paths with unchanged or smaller offending metrics, and **one**
new overlong line. `77f338fbb` wraps that line, giving a maximum of 144 UTF-16
units in the affected file. No baseline changed and no global strict pass is
claimed. Original failed logs remain intact.

Latest retained Fibonacci at `ef375` is **1.605549272945154×**, 95% interval
**[1.4364472786404399, 1.7696360228862134]**, still inconclusive against 1.5×.
Virtual dispatch at `10d` remains **1.982710053204195×**, below its 3× target.
The fixed 25-command qualification queue, current native/browser/full CI and
complete size comparison remain pending; the size catalog has 34 artifacts
and five without existing budgets. T12 requires two complete stable same-runner
reports and the baseline/gate evidence, with no mandatory third full run.
The bounded review found no additional demonstrated implementation gap; this
does not establish that all criteria passed.

## Earlier reconciliation and preserved checkpoint

An additive reconciliation observed at `4e9c5017307b1a31fc3f4c944c6965fe6b5822fd`
now appears in the JSON ledger's `historical_evidence_reconciliations` array and
the [progress document](a05-project7-progress.md). It records completed36 native
and eight-case browser results, return-lifetime stress, exact failed core/A01
observations and subsequent scoped repairs. The new `1520f50b1` async integration,
current CI and fixed performance queue remain pending. Original #1349's literal
15-target count is not established by the actual 13-target matrix. No original
criteria, hashes, historical assessment or issue state are replaced.

This `54e3bba84` checkpoint is preserved as evidence of the earlier repair state.
See [ongoing integration progress](a05-project7-progress.md) for subsequent repairs,
executed focused checks and measured targets. Its remaining-work statements are
revision-scoped and do not override newer results.

This update observes integrated revision `54e3bba84` and preserves the original
**83 issues, 210 exact acceptance criteria, issue-body hashes, capture hash and
historical observations** in the [JSON ledger](a05-project7-acceptance-audit.json).
Each issue now has a revision-scoped `current_revision_assessment`; its criterion
indices map one-to-one to the unchanged original criterion text. The original
fields describe the earlier audit boundary. No issue is closed by this update.

**Current integration is not green.** The latest selected main-merge run reports
189 passes out of 236 tests, with 47 failures. Callback frame lookup/rooting,
first-chance/unhandled callback policy and replay, managed/framework Object
formatting and construction, and generic/interface receiver behavior are assigned
repair work. Pending authoring or a passing earlier subset does not replace these
current failures. This auditor read existing files and reports; it ran no tests,
benchmarks, native SDKs or browser jobs.

## Revision-scoped execution evidence

The JSON evidence catalog records exact full revisions, source locations and
SHA-256 hashes. Scratch-only logs/reports must be retained with final evidence
before publication; their filenames alone are not durable qualification.

| Evidence | Revision | Actual result | Scope |
| --- | --- | --- | --- |
| `a05-full-integration-validation-17f2620c.log` | `17f2620c` | 2,732 / 2,784 passed; 52 failed | Full integration test run at that revision |
| `a05-regression-repairs-66898966.log` | `66898966` | 505 / 509 passed; 4 failed | Selected repair files |
| `a05-call-batch-and-seams-r1.log` | `e5802c2e` | 189 / 191 passed; 2 failed | Selected calls, batching and seams |
| `a05-source-batch-r2.log` | `000bbabd` | 6 / 6 passed | Source cross-call batching only |
| `a05-main-merge-focused-r1.log` | `54e3bba84` | 189 / 236 passed; 47 failed | Selected new-main integration files |

These runs differ in scope and cannot be summed or described as a monotonically
improving full-suite pass rate. The current 47 failing cases are retained in the
catalog by test location. No fresh full-suite result replaces the 2,784-test run.

The committed [integration measurements](https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/integration-measurements.md)
retain the original reports and their hashes. The byref stress report at clean
`17f2620c` records **1,000 generated CIL assemblies and 131,341 actual
instruction-boundary collections**, plus 96 source/reloaded/CIL counterparts and
owner-removal negative controls. This supersedes the historical claim that the
corpus had yet to be authored. New callback/root integration still requires a
current-revision rerun.

## Implementation changes since the historical boundary

| Area | Current implementation and authored evidence | Current remaining work |
| --- | --- | --- |
| Async and synchronization | Managed builders/awaiters, two-await/finally fixture and replay runner; source `lock`, Monitor, Interlocked and Volatile; `a05-29-async`, source synchronization/queue tests | Fresh native SDK matrix and final replay outcomes |
| Calls and interfaces | Source interfaces/generic interface methods, CIL maps, prepared virtual frames, calli, tail/jmp, source varargs | Assigned generic/callback regressions; exact byref scenarios and fresh native fixtures |
| Values and managed memory | Reference-containing structs, source copies/boxing, source Nullable, mutable Nullable text, spans, raw pointers, primitive-array fixed scopes | Current Object/construction regressions, exact named byref acceptance test, native memory capture |
| Arrays | Rectangular/lower-bound arrays, typed backing, FieldRVA initialization, cooperative bulk operations and resumable IndexOf equality | Native rank/bounds/copy/initializer traces and full-size fairness measurement |
| Exceptions | Two-pass dispatch, filter frames, nested cleanup, managed exception objects, source guest AppDomain delegates | 18 current callback-policy/replay failures across source/reload/CIL, other Object callback failures, fresh native abnormal-exit traces |
| Snapshots | Schema/version checks, immutable record sharing, fresh-owner portable graph, memory/array/Object/Nullable/varargs continuation validation | Current callback replay repairs, host-retention measurement and browser/worker qualification |
| Dispatch and numeric paths | Decode/token caches, bounded source batches, Int32/small-long numeric blocks, retained typed planes and one-instruction boundaries | Measured misses/inconclusive targets below; new pool/store changes remain unqualified until measured |
| Profiling, events and Wasm | Strict hook-free reference, counters, durations, trace/profile JSON and actual Wasm modules/IR/tiering/deoptimization/helpers | Profiling overhead, real Speedscope import and fresh browser/CSP/debugger/Wasm-host qualification |

The per-issue JSON mapping cites existing code, tests, examples and documents for
every remaining row. Paths identify authored or implemented coverage; they are
not fabricated individual test-pass claims. Batch evidence is explicitly labeled
with its scope and failures.

## Numerical targets and unmeasured gates

| Target | Latest relevant retained/read evidence | Current conclusion |
| --- | --- | --- |
| #1394 integer loop | `9ab4a805`: 1.8874x, 95% CI 1.7889–1.9565x | Met 1.5x at that revision |
| #1394 Fibonacci | `000bbabd`: 1.3052805380x, CI 1.2127846994–1.4032927120x | **Misses 1.5x**; pending optimizations are not evidence |
| #1391 virtual calls | `e5802c2e`: 1.7945107388x, CI 1.7334188836–1.8816065043x | **Misses 3x** |
| #1396 Int32 | 1M differentials at `1b162c88`; `9ab4a805` 6.1246x, CI 5.8200–6.3716x | Count and timing met on their stated revisions; rerun final code |
| #1397 small longs | 10M differentials at `1b162c88`; `9ab4a805` 6.0685x, CI 5.1945–6.3166x | Count and timing met on their stated revisions; rerun final code |
| #1398 scalar slots | `9ab4a805`: 30.3833% reduction, CI 26.0083–32.8266% | **Inconclusive** against 30% |
| #1390/#1392/#1399 | `9ab4a805`: zero warm offset maps, field token resolutions, pooled frame/storage allocations; post-unwind managed live-object checks | Exact counters apply to that revision; no unrelated host-allocation claim |
| #1395 float allocation | Exact float-factory counter and retained-capacity/GC trace harness are present | Zero float carriers alone does not establish zero total JS objects per iteration; broader criterion remains partial |
| #1400 root scans | 500-frame visitor/generator workload and liveness tests authored | 3x timing **unmeasured**; current callback-root repair also pending |
| #727 fairness | Every sort-phase slice and every sorted element checked by full-size harness | 1M elements, requested 8 ms / maximum 16 ms **unmeasured** |
| #1402 profiling off | Exact-parent hook-free generator and source/CIL paired protocol audited | Six strict less-than-1% overhead confidence intervals **unmeasured** |
| #1387 snapshots | Original logical record-fraction test plus explicit host-retention probe and full-copy comparison | Host retention **unmeasured**; no blanket less-than-2x claim |
| #1410–#1412 T12 | Real first/warm/startup/replay harness and delayed/noise gate controls | Two same-runner runs, startup baseline and candidate gate **unmeasured**; checked-in baseline is unqualified |

The snapshot probe preserves the original 1%-of-records mutation workload and
adds concentrated and distributed **1%-of-bytes** workloads. It reports post-GC
`heapUsed`, `external`, and `arrayBuffers` without double counting, plus exact
unique typed backing. Snapshot increment and combined live-plus-history are
separate ratios. All captured revisions must restore identically to independently
replayed full-copy snapshots; caps or incomplete captures remain incomplete.
These distinctions do not redefine the issue into a passing result.

## Parent runnable examples and API capability rows

Parents require examples, API/capability rows and regressions in addition to child
functionality. Existing evidence does not discharge every such deliverable.
The per-parent JSON `delivery_artifacts` records the located paths and the gap.

| Parent | Located runnable material | Documentation/delivery gap |
| --- | --- | --- |
| #74 scalar execution | `typed-float-slots.mjs`, `int32-specialization.mjs` | A current broad scalar capability row is not located; specialization examples are narrower |
| #75 calls | `trace.mjs`; native calli/generic fixture runners | Simple trace call does not demonstrate new call forms; exact byref/indexer/out example assigned |
| #76 managed pointers | Focused source/CIL tests and documented source/CIL memory profiles | Dedicated runnable byref/Span/fixed example and current capability table assigned |
| #77 exceptions | `examples/exceptions/Program.cs` | Existing example is a basic catch; filter/finally example and capability row assigned |
| #78 arrays | `examples/arrays/Program.cs` | Existing example is one-dimensional; rectangular/lower-bound example and capability row assigned |
| #79 snapshots | `snapshot-replay.mjs`, `portable-snapshot.js` | Explicit schema/portable API table exists; final callback/platform/retention qualification remains |
| #80 caches/dispatch | `trace.mjs` and qualification CLI | Specific preparation/invalidation example and current capability row need reconciliation |
| #81 numeric specialization | Int32 and typed-float runnable examples; target table | Distinguish prior measured results from current API/qualification status |
| #82 frames/roots | `reference-slot-liveness.mjs` | `frame-root-visitor.md` retains historical no-liveness wording; current capability row needs reconciliation |
| #83 profiling | Instruction/profile/trace/suspension examples and tables | Some rows retain historical export/trace status; measurements and Speedscope remain pending |
| #84 Wasm | Eligibility, encoder, call-tiering and runtime-bridge examples | Final per-host capability/unsupported matrix and browser/CSP/debugger results remain |
| #85 performance gate | Documented harness/startup/gate CLI and target tables | Real baseline and final reports remain pending |

A static search did not locate the exact combined **Swap, out and ref-returning
indexer** scenario required by #1361. Existing tests cover aliases, a ref-returning
method and `in` struct defensive copies. The integration owner assigned the exact
scenario and runnable memory/EH examples as a separate follow-up; this is an
identified test/documentation gap, not proof that the runtime cannot execute it.

No additional runtime defect beyond the assigned callback/Object/generic failures
was demonstrated by this static audit. That statement is limited to this review;
it is not a proof that all implementation is complete. Documented fixed
string/object-field pinning and owned-pointer-to-integer conversions remain
outside the primitive-array pin profile. The exact #1369 acceptance example is
primitive-array fixed storage, so that wider boundary is recorded without silently
expanding or closing the original criterion.

Fresh SDK 8/10 cells on Linux, Windows and macOS, browser/CSP/debugger checks,
actual Wasm hosts and Speedscope import remain pending. The new native workflow is
an executable qualification plan, not an executed result. Unsupported .NET8
numeric-oracle cells remain unsupported. Earlier native/browser reports retain
their original revisions and do not qualify the new integration.

---

# Historical audit text — preserved unchanged

The text below is the original audit and its earlier follow-up observations.
Its unresolved statements describe that earlier boundary; use the current
revision assessment above and in JSON when deciding current work.

# Project 7 acceptance audit — 2026-10-04

The [criterion ledger](a05-project7-acceptance-audit.json) accounts for **all 83
open issues and 210 stated acceptance criteria** in the captured Project 7 scope.
It supersedes the incomplete audit draft at `ca126f3d`. It does not mark any issue
complete. Epics and parent tasks aggregate their children; they are not counted
again as delivered capabilities.

This was a read-only review of issue bodies, implementations, tests and retained
evidence. The auditor ran no test, build, benchmark, browser or native job.
Results reported by the integration owner are identified separately from authored
tests. The JSON records the observed integration revision and pending snapshot
commits; later integration results must update the affected rows before closeout.

## Implementation and authored-test follow-ups

| Issue | Remaining work at the audit boundary | Owner / evidence |
| --- | --- | --- |
| #726 | Connect source `lock`, Monitor and synchronization builtin symbols/lowering to the existing runtime. | Snapshot agent; `execution/sync-primitives.js`, compiler runtime-gap and registry bridge paths. |
| #1362 | Complete source `__arglist`, typed-reference binding, lowering and runtime routes. | Control agent; CIL varargs is implemented. |
| #1379 | Complete source AppDomain guest delegate event lowering. | Control agent; runtime event continuations exist. |
| #1365, #1366 | Integrate and qualify source struct metadata/copies/boxing; source Nullable boxing is still explicitly unsupported. | Integration owner; `semantic/type-mapper.js` rejects Nullable at this boundary. |
| #1367–#1369 | Connect source unsafe/fixed/raw stack allocation and emitted CIL to the implemented memory runtime. | Memory/scope owners; connected source core is newly integrated. |
| #1357, #1384 | Finish resumable default struct Object equality/hash and managed `Array.IndexOf` equality, including captured-state validation. | Frame/memory owners; snapshot agent owns captured-only preflight. |
| #1370 | Author the exact 1,000-program, every-instruction byref GC stress requirement with a negative root-removal control. | Performance owner; focused deterministic lifetime tests do not satisfy this count. |
| #1389 | Rerun pending-fault/finally/await/monitor replay after fixture lifecycle repairs. | Snapshot commit `3e62e325`; retains all original outcome/alias assertions. |

The source frontend also rejects arbitrary interface-typed values in the audited
type mapper (#1355); statically closed generic constraint lowering does not prove
dynamic interface dispatch. That profile boundary must be explicitly reconciled
with the requested target scope. A missing source connection is an implementation
gap, not an unavailable native or browser runner.

## Subsequent integration follow-ups

The JSON now retains per-issue follow-up observations alongside the initial audit boundary. They do not replace the
criterion text or final-revision evidence. Since that boundary:

- Source synchronization and Monitor Wait/Pulse passed the integration owner's R3 run across source, reloaded source
  and CIL. Native trace comparison remains separate.
- The performance owner executed the 1,000-program byref stress corpus with 131,341 actual instruction-boundary
  collections, plus 96 source/reloaded/CIL counterparts. A clean integrated rerun is required because that development
  run coincided with another authored change.
- Six AppDomain lambda and active unhandled-callback replay cases passed across the three routes. Delegate variable,
  multicast, null-handler and explicit exception-property follow-ups require another integrated run.
- The Roslyn async fixture and runner are recovered, with two same-machine mid-await captures, local replay and fresh-VM
  portable replay. Recovery is complete; native qualification is still pending.
- Managed IndexOf equality now runs through resumable override frames. Its seven focused execution cases passed;
  captured comparison-link validation and malformed-snapshot regressions are authored separately.
- Mutable Nullable payload ToString, readonly/rvalue defensive copies, payload interior ownership and snapshot paths
  are implemented in coordinated runtime/memory batches. Their compiler connection and six replay cases await the
  integrated runner.

The initial source interface observation is a recorded profile boundary: #1355 directly requires CIL interface
maps and callvirt. The integration owner separately assigned the source interface bridge to the control agent.

## Exact evidence still required

| Requirement | Present evidence | Missing acceptance evidence |
| --- | --- | --- |
| #725 Roslyn async | Builders, awaiters, managed MoveNext frames and scheduler replay tests. | Independent two-await plus try/finally Roslyn fixture, paused and restored mid-await. |
| #1344 Int64 | Integration owner reports 100,000 pairs across 29 operations against the native helper oracle. | Final revision/command report and end-to-end engine routes. |
| #1353 numeric families | Hashed native fixtures and a three-route source/reloaded-source/CIL harness. | Full final family run after exception binding fixes; helper comparisons are not the full C# matrix. |
| #1371–#1377 exceptions | Two-pass/filter/cleanup/object runtime and focused tests. | Current native trace comparisons, including filter faults and cleanup replacement order. |
| #1381, #1384 arrays | Metadata-built lower-bound and private FieldRVA fixtures plus runtime replay. | Independent native Roslyn lower-bound/InitializeArray comparisons. |
| #1387 shared snapshots | 128 captures over >10 MiB; logical unique record/index bytes below twice the starting heap for 1% record changes. | Explicit agreement on logical bytes versus host retained-memory units and any requested host allocation/latency measurements. |
| #1396, #1397 specialization | Retained 1,000,000 Int32 and 10,000,000 Int64 handler differentials with zero mismatches. | The >=2x and >=3x timings; these differentials are JS reference comparisons, not native qualification. |
| #1395 floats | Typed raw-plane execution and zero counted slot materializations in a focused loop. | Zero total JavaScript carrier allocations, including helper-created `float()` objects outside ManagedHeap. |
| #1404 profile export | Speedscope schema/name/instruction-total tests. | An actual exported file loaded in speedscope. |

The numerical targets in #1391, #1394, #1396–#1400 and #1402 remain unqualified:
3x virtual calls, 1.5x source loops, 2x Int32, 3x long counters, 30% slot-load/store
reduction, frame allocation/retention, 3x root scans and <1% profiler-off overhead.
Correctness tests and the existence of a paired benchmark do not establish them.

The full #727 fairness run must sort one million elements and measure every
actual slice against an 8 ms budget and 16 ms maximum. The passing 512-element
focused fixture deliberately reports partial acceptance. The benchmark verifies
every sorted element, so successful timing alone cannot hide incorrect work.

The startup harness separates load, verify, preparation and first output in fresh
processes for three sample applications and three execution routes. Its focused
tests passed, but #1410/#1411 still require measured reports. The checked-in
`docs/performance/a05-baseline.json` is explicitly empty and unqualified. The gate
has real delayed-handler and noise regression tests; #1412 still needs a qualified
baseline from two serial runs on the same revision/runner within the 5% stability
bound. No synthetic baseline is promoted to measured evidence.

## Historical evidence reconciliation

`runtime-a05-e03-validation.json`, `runtime-a05-e04-validation.json` and
`runtime-a05-bugs-validation.json` preserve their original revisions, commands,
platforms and results. Their pass counts and browser/native reports apply to those
revisions and scopes. They do not qualify new schema2 snapshots, new memory/control
continuations, current compiler lowering, Wasm changes or the 83 open criteria.

`a05-close-open-work.md` records an earlier restricted closeout instruction and its
2,146-test run with nine reproduced baseline failures. The current request
supersedes its statement that remaining Project 7 work is deferred. Neither the
historical failures nor the historical source-language limitations should be
silently erased; the final integration report must give their current outcome.

Browser/CSP/debugger, native operating-system/architecture and real Wasm-host
qualification remain separate targets. A generated IL fixture is not native CLR
execution. A Node WebAssembly module is real Wasm execution but does not establish
browser UI or CSP behavior. Unsupported targets must be named rather than counted
as passing.
