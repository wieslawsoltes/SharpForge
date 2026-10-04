# Instruction profiler

Construct a source or direct-CIL VM with `profile: true` to enable bounded
instruction, call, managed-allocation and suspension counters. `vm.profiler` is `null` when
disabled. `instructionProfile(vm)` (or `vm.profiler.read()`) returns an independent
counter view with format `SharpForge.InstructionProfile/1` and clock
`instructions`. Instruction weights do not represent elapsed time. Optional
[elapsed durations](profiler-duration.md) add separate millisecond fields when
`profile.duration` is `true`; the default counter view remains unchanged.

```js
const vm = new CilVirtualMachine(assemblyBytes, {profile: {sampleBudget: 256}});
try {
  vm.run();
  console.log(instructionProfile(vm));
} finally { vm.stop(); }
```

Each entered opcode handler contributes one instruction, including a handler
that faults. Debugger pauses before dispatch, blocked scheduler time and CIL
initialization admission that defers a handler contribute none. Direct `step()`
is observed too. The existing VM `instructions` budget counter counts slice
attempts; it can differ for deferred initialization, a quota fault before
dispatch, or manual stepping. Source `SEQ` markers are instructions. Intrinsic
helper work is attributed to its invoking opcode, not fabricated guest calls.

Method records contain exclusive `instructions`, `inclusiveInstructions`, actual
managed `calls`, `allocations`, and `allocatedBytes`. Recursive activations each
contribute to inclusive counts. Stack samples aggregate instruction weights;
their weights sum to the exclusive instruction total. Samples flush after the
instruction budget, at calls and host slice/restore/stop boundaries, or on read.
Pooled frames are tracked by their fresh numeric IDs; samples contain only
method IDs. Parked or canceled contexts add no waiting-time instructions.
Closed CIL generic contexts retain distinct method rows across restored cache
rebuilds; a different assembly owner or instruction body gets a new row within
the same capacity bound.

Allocation hooks count successful managed heap allocation and positive backing
storage growth. Growth adds bytes without adding an object allocation. Failure,
shrink and collection do not add allocated bytes. These are managed logical
bytes, not host RSS or JavaScript allocation measurements. Sites use a method
ID and source instruction index or CIL byte offset; `-1` identifies work before
that method's first opcode. Host/startup allocations without a frame belong to
method 0 (`[runtime]`).

The top-level `suspensions` counter counts actual cooperative scheduler
transitions away from a live context: a committed park for a wait or freeze, or
a switch to another runnable context. Repeated host slices while already parked,
ordinary instruction/time-budget yields, debugger pauses, a self-selected
scheduling quantum and a queued context's first activation add nothing. Waking
or resuming a context also adds nothing. A later new suspension of that context
adds one more count.

The counter uses the same weak context-identity deduplication as scheduler event
observations, independently of whether `runtimeEvents` is enabled. Event-ring
overflow, subscriber cancellation and subscriber failures do not remove observed
suspensions. The counter retains no frames, task handles or context histories;
profiling adds one scalar, and a committed transition performs constant work.
When profiling and events are both disabled, the observation hook returns
without allocating suspension state or event payloads. No measured overhead or
throughput result is claimed for this counter.

`suspensions` is additive data in `SharpForge.InstructionProfile/1`. It belongs
to the host profiler, not the VM or scheduler snapshot. Restore retains its
cumulative total and establishes a fresh suspension-observation baseline.
Replaying execution before a wait can add another suspension; restoring an
already parked snapshot does not recount the old suspension, and its first wake
adds nothing. Rejected restore, cancellation and stop do not invent counts.
The stopped profiler remains readable. This counter does not measure wait
duration or native OS-thread context switches.

| Option | Default | Meaning |
| --- | ---: | --- |
| `maxMethods` | 65536 | Method records, including reserved runtime/capacity rows; minimum 2 |
| `maxStacks` | 16384 | Distinct sampled stacks, including the overflow row; minimum 2 |
| `maxSites` | 16384 | Allocation sites |
| `maxStackDepth` | 512 | IDs retained per sampled stack, including a truncation marker |
| `sampleBudget` | 256 | Instructions accumulated before updating inclusive/sample counters |

All limits are positive safe integers no larger than one million. Unknown
options reject explicitly. Capacity overflow retains totals in method/stack ID 1
(`[profile capacity]`); overflow counters state which detail was lost. A depth
limit retains the innermost frames and one marker, so omitted ancestor-specific
inclusive counts are not available. Cold stack capture costs O(bounded depth);
warm charges allocate no objects until the active frame changes. Storage is
bounded by configured method, stack/depth and allocation-site capacities.

Profiler state is host-owned and excluded from VM snapshots. Restoring the same
snapshot adds observations when execution repeats, without counting restored
frames as fresh calls. Stop flushes pending samples and retains readable history.
The separate `runtimeEvents` option keeps its existing delivery and callback
semantics; enabling both does not duplicate method events. Disabled profiling
creates no observer, samples, method records or allocation payloads. Guards and
the allocation-accounting seam still execute; overhead has not been measured.

| Capability | This batch |
| --- | --- |
| Source IR, source reloaded from CIL, direct CIL counters | Implemented; focused Node 24.21.0 regressions passed |
| Browser, native .NET, Rust/Wasm and cross-platform comparison | Not qualified |
| Opt-in monotonic elapsed-duration clock | Implemented in a separate leaf; focused qualification pending |
| Cumulative cooperative suspensions with events disabled | Implemented; new three-engine cases authored, validation pending |
| Formatted profile export | Separate follow-up |
| Off overhead below 1%, on overhead/latency/allocation evidence | Unmeasured; #1402 remains open |

Runnable example: `node examples/runtime/instruction-profile.mjs`.
`node examples/runtime/suspensions.mjs` demonstrates one guest wait/wake in each
engine with runtime events disabled. The new example has not been executed.
Serial focused validation passed all 41 profiler/event/frame-pool tests at
`a4cd3545` with Node 24.21.0. The command was:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-instruction-profiler.test.js tests/a05-cil-method-events.test.js tests/a05-cil-method-events-cancellation.test.js tests/a05-frame-pool.test.js
```

Record the tested commit, Node/browser version and command when collecting
evidence. Timing benchmarks must run alone on an otherwise quiet machine.

`tests/a05-profiler-suspensions.test.js` adds source/reloaded-source/direct-CIL
wait, switch, slice/pause, restore, freeze, cancellation and disabled-profiler
cases, plus independent CIL event-loss/subscriber-failure cases. These cases
have not run; the earlier validation evidence above predates this counter.
