# Project 7 integration progress — 2026-10-04

The current repair checkpoint is
`7d7fac37a672d0961fa82c457b64910c0c97a7d6`, including reconciliation with the
newer main used by the failed core CI merge. Earlier broad correctness and native
numeric replay results remain scoped to their recorded revisions. The new broad
regression selection passed all 3,369 tests at this checkpoint, and the published
`312cd9242` platform matrix has actual results described below. Remaining
performance and platform gates are still open; this checkpoint does not close issues or claim
Project 7 completion.

The original [acceptance ledger](a05-project7-acceptance-audit.json) retains all
83 captured issues, 210 exact criteria, issue-body hashes and historical
assessments. Its `54e3bba84` state is historical. Additive repair observations link
new evidence without changing the original criteria or relabeling earlier runs.

## Current repair checkpoint

The [CI repair archive](a05-evidence/integration-validation-20261004/ci-repair-checkpoint/README.md)
preserves the initial 216-test selection at `59da6ca77` with 208 passes and eight
failures, and the subsequent runtime selection at `0e111a882` with 306 passes and
two failures out of 308. Corrected fixtures use decoded method identities,
engine-specific result contracts and ordinary startup admission. The remaining
two source-profiler fixture failures reproduced separately; the repaired
four-test fixture then passed all four cases. That patch was uncommitted during
the focused run and later committed as `a75cafa0e`; it does not turn the earlier
308-test selection into a passing run.

At `65130534e`, all 53 tests in the seven-file byref/Wasm latency-harness and
adjacent tiering, OSR, runtime-bridge, deoptimization and options selection passed,
with zero failures or skips. The new harnesses now have correctness and rejection
tests; prescribed cold/warm p50/p95/p99 and allocation measurements remain
pending. These are not speedup results or a T12 qualification baseline.

The [A00 contract archive](a05-evidence/integration-validation-20261004/a00-contracts/README.md)
separately retains 81/81 focused tests and 2/2 image-compatibility tests, along with
the incomplete full-A00 attempt interrupted at a nested resource-slot wait. The
guard and generated-contract repairs retain exact old/new hashes. Their counts
are not added together or relabeled as later runs.

After the nested run-slot lease repair, the full manifest-selected A00 run
passed all 482 tests with zero failures or skips at `c45e90c6a`. The
[completed gate archive](a05-evidence/integration-validation-20261004/completed-gates/README.md)
preserves that result and its exact command alongside the later local gates:
24/24 Node browser-heap/Wasm-bridge/native-plan tests, six Python browser-contract
tests, and `npm run check` at `0e27de925`; then 8/8 observer-cleanup tests, oracle
license policy and the strict build at `7d7fac37a`. The static check found 1,318
Node files with zero unassigned files, zero syntax errors across 4,702 modules,
and zero import errors across 4,647 inspected / 4,690 linked modules. Those
commands overlap and their test counts are not combined.

The subsequent [broad regression run](a05-evidence/integration-validation-20261004/broad-a05-7d7fac37a/README.md)
completed on clean `7d7fac37a`: **3,369/3,369 passed**, zero failures, skips or
cancellations, in 390,352.526802 ms on Node v24.19.0. It selected 313 top-level
`a05-*.test.js` files plus preemption and security limits, using the one-run,
one-test, 512-MiB wrapper. The original expanded command, unchanged HEAD and
clean before/after status are retained. This is a broad Node regression result;
the full repository, separate long numeric/GC-stress protocols, prescribed
performance measurements and new browser heap/GC executions remain distinct.

The added browser heap/GC path now has local Node and Python contract coverage,
including cleanup after native compilation refusal; actual execution of that
new case in the three browsers remains a separate qualification. A passing
strict build likewise does not establish measured build-size growth.

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
| Broad A05/preemption/security selection | `7d7fac37a` | 3,369 passed, zero failures or skips; earlier `02c941f53` 3,320-pass run remains separate |
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

The added managed-reference and actual compiled-Wasm harnesses supply the
previously missing parent-issue cold/warm latency and allocation measurement
paths. They retain complete guest work, exact results and backend identities,
with VM-cold preparation separate from warm execution. Their passing focused
tests do not close the measurement criteria until prescribed reports execute.

## Platform and publication gates

The [native-width/byref harness checkpoint](a05-evidence/integration-validation-20261004/native-width-byref/README.md)
at `46ed6141a` passed 28/28 focused tests with no skips, `npm run check`, and the
oracle license-policy check. Its exact journal and raw outputs are retained.
The qualification plan now defines 34 native cases across six SDK/OS cells plus
two targeted Windows x86 width checks pinned to SDK 8.0.425 and 10.0.201.
The expanded plan subsequently ran against published `312cd9242`; those actual
results are recorded below. The local harness tests themselves do not establish
native process width or replace platform qualification.

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
static import validation. Contract and launcher tests passed locally. Original
screenshots, reports and failed outputs remain byte-for-byte evidence of
`e09324d3`; the later results do not rewrite that failed matrix.

The [published `312cd9242` archive](a05-evidence/ci-312cd924-20261004/README.md)
retains actual Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 reports with
7/7 cases passing in each browser. Firefox used headed Xvfb; Chromium and WebKit
were headless, with Playwright 1.63.0. Each report includes actual Wasm execution,
debugger deoptimization, CSP fallback, and official Speedscope opening of all
three engine profiles. It does not prove every Wasm heap/GC workload in browsers.
Both targeted Windows x86 cells also passed: SDK 8.0.425 with guest .NET 8.0.31,
and SDK 10.0.201 with guest .NET 10.0.5, each observed as X86/win-x86 with
`IntPtr.Size == 4` and native output compared with the Roslyn CIL and all three
compiler routes. Their reports, installation provenance and hashes are retained.

The standard [native matrix run 37225004330](https://github.com/wieslawsoltes/SharpForge/actions/runs/37225004330)
has these completed coordinator-reviewed job-log outcomes at this checkpoint:

| Published `312cd9242` cell | Passed | Failed | Explicitly unsupported |
| --- | ---: | ---: | ---: |
| Ubuntu / SDK 8 | 30 | 0 | 4 |
| Ubuntu / SDK 10 | 33 | 0 | 1 |
| Windows / SDK 8 | 31 | 0 | 3 |
| Windows / SDK 10 | 34 | 0 | 0 |
| macOS / SDK 8 | 30 | 0 | 4 |
| macOS / SDK 10 | 33 | 0 | 1 |

The unsupported outcomes are three SDK10-only numeric policies in SDK8 cells,
plus observed CLR managed-varargs rejection on Unix. All six standard cells
and both targeted x86 jobs have completed. The
[standard-native archive](a05-evidence/ci-312cd924-20261004/standard-native/README.md)
now retains all six aggregate reports and their 204 detailed case outcomes,
separately from the browser and x86 archive. Those case executions contain 191
passes, zero failures and 13 explicitly unsupported outcomes. All eight native
jobs and all three browser jobs completed successfully, but job success does not
turn a partial native aggregate into a full pass. The browser reports still
cover their original seven cases, before the new heap/GC case was added.
No unsupported outcome is counted as
a pass. All these focused jobs tested pushed tree
`21dd929c4087bb7dc97fdd735d88ae36d1e76050`. The failed repository core instead
tested PR merge `4802e7382be0784164fdc8d1b71a6bbfc92fe192`, tree
`90a9350e1a692628dd9dfbc0f2c4e382588907c4`, against newer main `75f0caad…`.
That failure and current runtime changes still require their own qualification;
the passing published platform observations cannot be relabeled as current-head
results.

The native plan now adds the exact combined Swap/out/ref-indexer/in-struct example
and observed native-width case. Both compare the actual native output with the
same Roslyn CIL and all three SharpForge compiler routes, using pointer width
from a separately executed native probe. Completed cells now provide actual
native parity for those paths at the published revision above. The expanded plan
has 34 independent cases across SDK8 and SDK10 on
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
