# Module initialization — SF-A02-T72

Module initializers run through a real `<Module>::.cctor` in both executable and library output. Ordinary Main,
top-level entry and async Main wrappers no longer inline those calls. The CIL VM treats the module constructor as a
mandatory verification root and runs it before initializing the selected entry type, including a host-selected
library method. A program without a module constructor retains ordinary entry-type initialization.

The implementation reuses the runtime's existing initialization gate, managed call frames, scheduler, cached faults,
GC roots and snapshot representation. The selected entry frame waits while module startup runs. This preserves
once-only execution, declaration order, reentrant calls, and the original cached failure rather than creating a
second startup mechanism. Verification still enforces the existing method/instruction budgets; unrelated unreachable
methods are not promoted to startup roots.

## Correctness evidence

The frozen pre-fix commit `fc4d9d994d93d75bac94131da62faa8fd13442d3` produced 10 passes and 13 failures from 23
baseline probes. The original raw log is retained. After the correction, all 23 passed, including independent raw
CIL admission, ordering, once-only execution, faults, GC roots and snapshot restoration.

The final focused replay at `e689e7f1e99e3da593db2021191d0e2d0d91589b` passed **114/114 tests with zero skips** in
14.494 seconds. Its six files cover module source/direct-CIL output, genuine native consumers, static initialization,
managed-IL host behavior, adjacent entry/delegate lowering, and exact oracle fixture selection. The checkout was
tracked-clean before and after. Commands, scope and log hash are recorded in
`tests/fixtures/module-initialization/qualification/qualified-results.json`.

Seven independent genuine Roslyn programs cover plain Main, static fields, static constructors, an initializer
calling the entry type, declaration order, pre-entry failure and the no-initializer control. Captures used .NET SDK
10.0.201, reference pack 10.0.5 and Roslyn 5.3.0.0. Registry and real-reference SharpForge library artifacts also ran
under the same independently compiled Roslyn consumer, each in its own process/directory. All observe one startup
sequence across repeated calls. The capture changed only the seven selected module pins.

Top-level entry passed both actual CLR and CIL VM execution. Async Main passed actual CLR execution with the correct
pre-entry module output. Its VM check deliberately asserts the current `IL_REFERENCE` rejection for the five missing
Task/awaiter/builder ABI members; it is not an async VM execution pass. That separate runtime ABI work remains open.

An initial full replay is retained as well: 111/114 passed. Two CLI tests failed because the worktree lacked tracked
`apps/cli` files; restoring that sparse-checkout path resolved them. The third exposed the async VM ABI boundary,
which now has an exact negative admission assertion alongside its positive native result. The former delegate test
assertion that required module calls inside Main encoded the old defect and now requires the real module constructor.

## Performance and remaining scope

[The paired benchmark](../project5-module-startup-benchmark.md) records both comparable controls, separate compilation
and fresh-VM execution phases, raw samples, medians/p95, output size, allocation counters and explicit author
acceptance of the measured startup cost. It does not use a semantically failing program as a performance baseline.

This batch qualifies module startup on the JavaScript CIL VM and native CLR. It does not claim new Rust/Wasm backend
startup support or browser timing. The broader Project #5 item #653 also includes covariant returns and SkipLocalsInit;
those require their own current acceptance replay and remain open. Canonical source-image loading is unchanged.
