# Project 7 integration progress — 2026-10-04

The repaired A05 execution and performance work is integrated at
`8f6eba479ee93874b092f55ec9ffb825ded950f9`, including main
`19755847de71941a96ff4888d3b16402c966c401`. The broad correctness selection and
the repaired native numeric replay now have passing evidence. Remaining
performance and platform gates are still open; this checkpoint does not close
issues or claim Project 7 completion.

The original [acceptance ledger](a05-project7-acceptance-audit.json) retains all
83 captured issues, 210 exact criteria, issue-body hashes and historical
assessments. Its `54e3bba84` state is historical. Additive repair observations link
new evidence without changing the original criteria or relabeling earlier runs.

## Repaired behavior and correctness evidence

The integrated repairs cover callback frame/root ownership and replay, managed
Object callbacks, constructed source and CLI generic identities, source interface
dispatch, exact byref assignment evaluation, struct copies/boxing, Nullable calls,
and shared structural admission limits. Source, assembly-reloaded source and
direct CIL evidence remains identified separately where each route ran.

The first completed remote matrix at `e09324d3` exposed additional defects and
target-policy differences. The resulting changes include explicit SDK-specific
first-chance failure policy and a separately executed runtime probe; managed
auto-layout storage/root plans for real Roslyn async state machines; observed
native varargs classification; exact `Unsafe.Unbox<T>` admission and foreign-VM
reference rejection; Nullable constrained calls; and compiler literal/source
floating conversion repairs. Actual retained SDK8 DLLs now exercise async replay
and Unsafe.Unbox, and the retained SDK10 memory DLL exercises the native trace.
The [native repair archive](a05-evidence/integration-validation-20261004/native-repairs/README.md)
and [policy/snapshot archive](a05-evidence/integration-validation-20261004/policy-weak-intern/README.md)
preserve the failures that led to these fixes as well as the subsequent passes.

| Selection | Recorded revision or scope | Result |
| --- | --- | --- |
| Broad A05/preemption/security selection | `02c941f53` | 3,320 passed, zero failures or skips |
| Final focused native repair selection | Exact run identity in the final archive | 63 passed, zero failures or skips |
| Final literal/constant checks | `8f6eba479` | 16 passed, zero failures or skips |
| Static repository checks | `8f6eba479` | `npm run check` passed; quarantine rerun passed |
| Independent byref GC stress | `5379d076a`, then fresh repeat at `8f6eba479` | Both runs passed all six tests; counts are not combined |
| Full saved native numeric replay | `139917fe5f` | 10 passed, one failed, zero skips; the 100,000-pair C# test passed all three routes |
| Repaired complete conversion matrix | Tested source equivalent to `b3673745c` | All 2,112 cases passed in helpers, source, reload and direct CIL |

The [final repair validation archive](a05-evidence/integration-validation-20261004/native-repairs/final/README.md)
records the latest commands and measured identities. Its results are scoped to
those selections and revisions. The 3,320-test run does not replace the separately
recorded long numeric replay. Earlier 3,187-test and 3,236-test results remain in
the [main reconciliation archive](a05-evidence/integration-validation-20261004/main349/README.md).
Overlapping cohorts are never added into a synthetic total.

The numeric replay now consumes the exact hash-verified `.cs` files that were
compiled by the native oracle, including their `using System;` context. The full
100,000 operand pairs across 29 signed/unsigned Int64 operations passed both the
helper comparison and the same C# program through source, reloaded source and
direct CIL at `139917fe5f`. UInt32, native-width, float, Decimal, checked/shift and
small-storage families also passed there. Its one remaining conversion test then
exposed a valid Int64-minimum literal crashing the legacy constant adapter, an
ambiguous generated native cast, and a source cast that converted a floating
carrier object to NaN. These were repaired without altering oracle values or
case counts. Focused literal/constant runs passed 16/16 and 18/18; the complete
2,112-case matrix then passed separately. The [independent replay archive](a05-evidence/numeric-independent-20261004/README.md)
retains both original failed runs and the additive repair proof. It does not
invent a full 11/11 execution at a later revision.

The fresh byref stress repeat retains the same corpus hash and covers 1,000
distinct CIL programs, 131,341 actual instruction-boundary collections, 96
source/reloaded/compiler-CIL counterparts, and negative owner-root removal
controls. The source counterparts do not create unbox interiors; direct CIL
provides the boxed-owner coverage. Node stress evidence is separate from native,
browser and Rust qualification.

The build attempt at `8f6eba479` failed on static module cycles. Subsequent
dependency-boundary repairs through `39055a8527e840b4534c45ffca122f3f89466106`
separate ManagedFault, delegate call admission and scheduler context completion.
The strict build passed at clean `807879f511a877ba7e5e1e0e63d9b9b75ba91319`,
whose relevant source trees match `39055a852`; focused cohorts passed 78/78 and
19/19. The [build archive](a05-evidence/integration-validation-20261004/build-cycle-repair/README.md)
preserves both the original failure and the successful rerun without changing
the cycle-validation rule.

## Measured optimization status

| Target | Exact measured revision | Observed result | Decision |
| --- | --- | --- | --- |
| Scalar slot time per guest instruction | `48c62243`, 100 pairs | 71.686% reduction; 95% CI 70.380–72.616% | Meets 30% at that revision; final qualification remains separate |
| Virtual-call cache | `48c62243`, 20 pairs | 2.153884x; 95% CI 1.835978–2.521246x | Misses 3x |
| Source Fibonacci | `48c62243`, prespecified 100-pair repeat | 1.472784x; 95% CI 1.413465–1.523999x | Inconclusive against 1.5x |
| Source root scanning | `5909d54f`, 100 pairs | 3.397571x; 95% CI 3.326203–3.482088x | Historical 3x pass; fresh run needed after runtime/root repairs |
| CIL root scanning | `5909d54f`, 100 pairs | 3.343396x; 95% CI 3.253705–3.506038x | Historical 3x pass; fresh run needed after runtime/root repairs |

The [scalar/virtual reports](a05-evidence/slots-virtual-48c62243/README.md) and
[both Fibonacci reports](a05-evidence/source-fibonacci-2026-10-04/README.md) remain
unchanged. The larger Fibonacci repeat is not selected as a pass. Recorded warm
managed/frame/storage allocation counters are exact for their scopes; they do
not measure every host JavaScript allocation. Diagnostic CPU profiles do not
establish speedup targets.

Earlier integer-loop, Int32 and small-long measurements met their thresholds at
their recorded revisions. The strict profiling-off comparison at `9344fe8cb`
completed 100 pairs per row but did not qualify: two required CIL rows missed the
1% overhead threshold and four were inconclusive. Later runtime and private
profiler changes require fresh measurements with the declared reference.

The original snapshot workload at `5909d54f` completed 128 captures and matching
restores: history used 1.134337 times the managed heap; combined live/history
memory used 1.468457 times it. The supplemental distributed-byte workload stopped
at its cap after 23 captures. Neither result is a universal host-memory guarantee,
and the final runtime/snapshot changes require a fresh prescribed run.

The original float-allocation criterion permits trace-based per-iteration
measurement. Historical warm-loop reports distinguish fixed entry cost from
recurring allocation and retain their original report statuses. A fresh run of
the exact allocation protocol remains pending. The passing native float family
and conversion matrix support the separate float-differential clause; they do
not establish zero allocation.

The remaining measured gates are final source Fibonacci and virtual dispatch,
profiling-off overhead, root scanning, frame/cache/pool counters, prescribed
snapshot retention and full-copy replay, the original float-allocation workload,
full-size fairness, and specialized Int32/Int64 differential/target runs. Full
fairness means one million sorted elements with every actual slice checked
against the 8 ms budget and 16 ms maximum. T12 still needs two complete serial
runs on the same final revision and runner, within 5% stability, followed by the
actual candidate gate. Focused tests and an authored harness do not replace
these measurements.

## Platform and publication gates

The [native-width/byref harness checkpoint](a05-evidence/integration-validation-20261004/native-width-byref/README.md)
at `46ed6141a` passed 28/28 focused tests with no skips, `npm run check`, and the
oracle license-policy check. Its exact journal and raw outputs are retained.
The qualification plan now defines 34 native cases across six SDK/OS cells plus
two targeted Windows x86 width checks pinned to SDK 8.0.425 and 10.0.201.
Those expanded native CI executions are pending; the local harness tests do not
establish native process width or replace fresh platform qualification.

The [completed `e09324d3` CI matrix](a05-evidence/ci-e09324d3-20261004/README.md)
is retained with its original outcomes: all six native SDK8/SDK10 OS jobs failed,
with three explicitly unsupported numeric policies per SDK8 cell. Chromium
passed seven cases; Firefox passed four and failed three Speedscope imports;
WebKit passed six and failed the CSP observation case. The repository core job
failed because four tests were missing from manifests. Completed execution of
that matrix is not a passing qualification.

The integrated browser repairs select Firefox's headed/Xvfb graphics path and
collect graphics observations; WebKit CSP checks now require an observed native
compilation denial and fallback outcome rather than assuming a violation event.
Core repairs assign the omitted tests, provide Python package setup, and retain
static import validation. Contract and launcher tests passed locally; a new
published CI run is pending. Original screenshots, reports and failed outputs
remain byte-for-byte evidence of `e09324d3`.

The native plan now adds the exact combined Swap/out/ref-indexer/in-struct example
and observed native-width case. Both compare the actual native output with the
same Roslyn CIL and all three SharpForge compiler routes, using pointer width
from a separately executed native probe. These are authored qualification paths,
not new native results. The expanded plan has 34 independent cases across SDK8 and SDK10 on
Linux, Windows and macOS, plus Chromium/Firefox/WebKit Wasm, CSP, debugger and
official Speedscope UI checks. SDK selection is separate from the guest runtime
patch; a runtime probe records the latter where executed. Observed target
limitations remain unsupported outcomes, not passes. The numeric replay uses a
saved .NET10 macOS ARM64 oracle with 64-bit native integers and does not claim
fresh SDK/OS or ABI32 coverage.

The PR remains a draft pending the remaining gates. Push workflows identify the
actual owned continuation-branch commit while main moves; they do not invent a
PR merge result. Historical retained branches remain available. This checkpoint
records no main merge and no blanket Project 7 completion.
