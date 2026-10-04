# Direct CIL Task state-machine ABI

The direct CIL interpreter has a bounded Task ABI contribution. This is separate from
the source VM's `SharpForge.Runtime.Async` lowering and from native .NET execution.
At executable commit `974a5621bc59088b20b63034306e35b3af2a2122`, the JavaScript direct
CIL interpreter passed 16 focused tests, including genuine Roslyn/CoreCLR comparisons,
and 67 adjacent source-scheduler, intrinsic, delegate and storage tests, with zero skips.
The separate dispatch regression batch passed 33 of 34 tests. Its remaining assertion
expects an older generic-storage diagnostic string; that expectation and the current
rejection text are both present in the frozen baseline source. An isolated replay of
that assertion on exact baseline `eadd85149b0740f337f7b8f3e92d259353892fdb` reproduced
the failure (zero passed, one failed, zero skipped). It is a confirmed pre-existing
assertion failure and is not counted as passing.
Commands, timings, source identity and all failed/successful raw logs are recorded in
`tests/fixtures/cil-async/qualification/post-fix.json`.
After the reviewed owner-rejection optimization, the unchanged 16 focused tests passed
again at `35e1914a2811681cd5aaac8ba0a7741fe4f441c5`, with zero skips. That repeat and
its single paired measurement are recorded in `qualification/owner-filter-review.json`
under the same fixture directory; the earlier adjacent results retain their original head.
The frozen baseline is recorded in `tests/fixtures/cil-async/qualification/pre-fix.json`:
six focused failures, zero skips, and eight genuine Roslyn Debug/Release programs that
ran on .NET while their CIL VM admission was rejected.

The supported member definitions cover Task and Task<T> builders, TaskAwaiter and
TaskAwaiter<T>, and the real YieldAwaitable/YieldAwaiter ABI. Calls require exact
substituted signatures and runtime assembly reference identities. Builder Start and
await registration contribute their actual IAsyncStateMachine implementations to the
ordinary verifier worklist. These callbacks keep the existing stack and method budgets.
Explicit MethodImpl declarations and implementations must have compatible signatures.
The public CIL helpers `asyncTypes`, `asyncValueType`, `asyncMethodDefinition`,
`asyncStateMachine` and `asyncCallbackTargets` expose this proof data to the runtime;
they do not execute callbacks or load external assemblies.

Builders and awaiters use immutable value records containing a managed Task reference.
Only intrinsic ABI values and internal types proved to implement IAsyncStateMachine
receive this additional managed-reference value storage. General aggregate admission
is unchanged. Copying or updating such a value rebuilds its immutable reference
inventory; the collector traverses that inventory without scanning metadata per edge.
The existing limits on other generic aggregate arguments and nested value storage
still apply. This contribution does not claim unrestricted Task<T> value-type payloads.

Start enters MoveNext through the ordinary verified managed-call path. A first Release
state-machine suspension creates a stable managed box and executes its SetStateMachine
method before registering the continuation. Subsequent continuations reference that
box. Proved external IAsyncStateMachine MethodImpl declarations use these exact local
callback bodies; malformed signatures, duplicate declarations and local same-name
interfaces retain explicit rejection. Callback contexts do not own the final Task through context return: only the
builder's SetResult or SetException completes it. Pending continuations own managed
call data, are rooted and snapshotted, and are removed before delivery. Task completion
pins their receivers before changing terminal status, including while waiter failures
and callback contexts allocate. VM stop drops
pending callbacks; normal task cancellation still delivers await continuations.

GetAwaiter().GetResult() delivers the original managed exception. Wait and Result use
an explicit aggregate-failure mode in the scheduler wait record. Completed tasks retain
their original exception reference in managed heap storage. Delay(int) distinguishes
the infinite -1 timeout, zero, and the nonnegative Int32 range. No JavaScript Promise,
host delegate or synchronous run-until callback executes a state machine.

Focused qualification commands:

```sh
node scripts/limited.js node --test tests/a05-cil-async-profile.test.js tests/a05-cil-async-native.test.js \
  tests/a05-cil-async-continuation-roots.test.js
node scripts/limited.js node --test tests/compiler-lowering-async.test.js tests/compiler-lowering-async-streams.test.js \
  tests/a05-seams-cil-intrinsics.test.js tests/a05-managed-address.test.js tests/a05-value-storage.test.js \
  tests/a05-delegate-targets.test.js
```

The native driver compares real Roslyn Debug and Release images, and independently
emitted SharpForge images, with actual .NET output. It covers ordinary and suspended
completion, Yield, exception identity, Wait/Result aggregation, Delay boundaries,
reference-field replacement, GC, snapshot/restore and collection during allocation.
Malformed ABI identities, signatures and callback bodies are verifier controls.
The focused adjacent tests cover the shared source scheduler and ordinary storage.

ValueTask, custom notification awaiters, async void and async iterators remain separate
runtime extensions. Browser and Rust/Wasm execution have not been qualified for this
contribution; further generic state-machine boundary qualification also remains queued.
The first paired measurement exceeded the ordinary-control regression budget. No
broad performance or causal speedup claim is made. The reviewed rejection filter and
single approved repeat showed no regression in that control, as recorded below.

The prepared benchmark uses 80 warmups and 24 samples, reporting median/p95 admission,
execution and total time plus managed allocations. It includes an ordinary arithmetic
and intrinsic-call control. A directory produced by the genuine reference capture adds
the same Debug/Release async images on both revisions; unsupported baseline images are
reported as rejected rather than timed as successful executions.

```sh
node scripts/limited.js node packages/runtime/bench/cil-async.mjs <reference-capture-directory>
```

The paired driver exports only the Git-pinned runtime workspace dependency sources
and package manifests into temporary directories. It creates local package aliases,
checks every exported source hash before and after each process, and removes the
exports afterward. It does not create or modify a Git worktree. Both revisions receive
the same committed runner and ordinary fixture builder; emitted fixture hashes must
match. Native fixture bytes and output are checked against the genuine capture record.
The baseline is fixed at `eadd85149b0740f337f7b8f3e92d259353892fdb`.

Four fresh processes run serially in baseline/candidate/candidate/baseline order. Each
per-process case receives 80 warmups and 24 samples, retaining the individual samples
and per-process results. The combined report also provides pooled median/p95 values
and percentage changes for cases supported by both revisions. Unsupported baseline
async images remain explicit rejected entries and receive no invented timing.
Every successfully constructed VM is stopped in `finally`, after elapsed times and
allocation counters have been captured. Cleanup is outside the measured regions.
The driver checkpoints its report after completed runs and preserves them if later
verification, output parsing or export preparation fails. A timeout records stdout,
stderr and an explicit failure, and terminates the isolated Node process group before
temporary exports are removed.

```sh
node scripts/limited.js python3 packages/runtime/bench/cil-async-paired.py benchmark \
  --candidate <exact-full-candidate-commit> --capture <reference-capture-directory> --output <report.json>
```

The same exporter can replay only the unresolved diagnostic assertion against the
frozen baseline test and runtime sources. This command preserves the assertion and
its real exit status; it does not import candidate runtime code or translate failures
into passes. Its recorded execution reproduced the existing failure.

```sh
node scripts/limited.js python3 packages/runtime/bench/cil-async-paired.py dispatch-baseline --output <report.json>
```

The exported dependency sources occupy about 2.7 MB per revision. The paired report
is expected to remain below 1 MB; the baseline-only report below 250 KB. These are
preparation estimates, not measured execution or output-size results.

The completed ABBA run compared baseline `eadd85149b0740f337f7b8f3e92d259353892fdb`
with candidate `4c72e6199f021c09365253188c055689d357802a` on Node 24.19.0, Linux x86-64,
through the normal machine-wide single-slot limiter. The source exports and fixture
hashes matched their pinned records. The ordinary control's pooled measurements were:

| Metric | Baseline median / p95 | Candidate median / p95 | Median change |
|---|---:|---:|---:|
| Admission | 0.565 / 0.772 ms | 0.667 / 1.547 ms | +18.10% |
| Execution | 2.402 / 3.739 ms | 2.958 / 4.779 ms | +23.13% |
| Total | 2.957 / 4.310 ms | 3.771 / 5.571 ms | +27.54% |
| Managed allocations / bytes | 0 / 0 | 0 / 0 | No change |

The fresh-process ordinary total medians were A1 3.028 ms, B1 2.807 ms, B2 4.286 ms,
and A2 2.299 ms. This substantial variation is part of the evidence; the pooled
over-budget result does not establish a causal source attribution. The four async
images were rejected by the baseline and successfully measured on the candidate, so
there is no async baseline execution-time comparison. Full raw reports and hashes are
in `tests/fixtures/cil-async/qualification/performance-review.json` and its referenced
artifacts. The paired report is 468,110 bytes; the baseline replay report is 137,037 bytes.

The reviewed optimization rejects owners outside the existing Task/builder/awaiter/Yield
set before constructing and substituting method signatures. It is a rejection filter;
known async owners retain their full signature and trusted metadata identity checks.
One approved ABBA repeat at `35e1914a2811681cd5aaac8ba0a7741fe4f441c5` used the same
baseline, fixture bytes, 80 warmups and 24 samples per process case:

| Metric | Baseline median / p95 | Candidate median / p95 | Median change |
|---|---:|---:|---:|
| Admission | 0.450 / 0.750 ms | 0.385 / 0.601 ms | −14.41% |
| Execution | 1.705 / 3.267 ms | 1.635 / 2.146 ms | −4.09% |
| Total | 2.193 / 3.719 ms | 2.032 / 2.627 ms | −7.32% |
| Managed allocations / bytes | 0 / 0 | 0 / 0 | No change |

The fresh-process total medians were A1 2.307 ms, B1 1.957 ms, B2 2.114 ms and A2
2.002 ms. This bounded repeat showed no ordinary-control regression. Both rounds'
raw observations and per-process variation remain retained; neither establishes a
broad speedup or causal attribution. All four candidate async images ran and matched
the captured native output; the baseline still rejected them. The 468,272-byte repeat
report, source hashes and unchanged focused-test log are referenced by
`tests/fixtures/cil-async/qualification/owner-filter-review.json`.
