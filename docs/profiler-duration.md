# Optional profiler durations

Enable elapsed sampling on source, reloaded-source or direct-CIL VMs with
`profile: {duration: true}`. Instruction profiling remains the default and its
output is unchanged when duration is omitted or false.

```js
const vm = new CilVirtualMachine(assemblyBytes, {
  profile: {duration: true, sampleBudget: 256, clock: () => performance.now()}
});
try {
  vm.run();
  console.log(instructionProfile(vm));
} finally { vm.stop(); }
```

The optional `clock` must return finite, nonnegative, monotonically
nondecreasing milliseconds. Its default is `performance.now()`. A supplied
clock is never called unless duration is enabled. Invalid option types reject
at construction; equal consecutive clock readings are valid.

`SharpForge.InstructionProfile/1` keeps its `clock: 'instructions'`, method
instruction counts and sample weights. Duration adds these fields:

| Location | Additional fields |
| --- | --- |
| `duration` | `enabled: true`, `clock: 'monotonic'`, `unit: 'milliseconds'`, `totalMilliseconds`, `intervals` |
| Each method | `exclusiveMilliseconds`, `inclusiveMilliseconds` |
| Each stack sample | `milliseconds` |
| `overflow` | `stackMilliseconds`, `stackDepthMilliseconds` |

Exclusive method durations and sampled stack durations each sum to the total.
Each recursive activation contributes to inclusive duration. Existing capacity
limits apply: overflow samples retain elapsed totals; a truncated stack cannot
attribute duration to omitted ancestors. Instruction-only exporters continue
to use instruction weights. This leaf does not add a duration export format.

Intervals begin immediately before dispatch and close at the sampling budget,
managed calls, active frame changes, host slice boundaries, explicit reads,
restore or stop. The budget boundary retains the following handler's work,
including the final opcode in a method. Manual CIL `step()` closes its interval
before returning to its caller. Debugger/host delay between steps or slices,
parked scheduler time, and idle time around snapshot restore are excluded.
Synchronous host services and interpreter overhead within an interval are
included. These are elapsed observations, not CPU measurements or a precise
cost model for individual opcodes.

The profiler remains host-owned and outside snapshots. Restore does not rewind
the clock or counters; executing restored work adds duration. Restored frames
do not become fresh calls. Stop retains readable history and closes pending
intervals before cleaning live and parked execution state.

Clock exceptions, non-finite values, negative values, regressions and total
overflow latch a host observer failure. Recursive inclusive totals are checked
separately because one elapsed interval contributes to every active invocation.
Instrumentation does not throw it into
managed dispatch: guest execution reaches its current slice boundary first.
An explicit profile read always reports the latched error. An automatic host
boundary reports it only when there is no existing guest fault or debugger
exception; existing guest failure remains visible. Stop completes cleanup
before reporting a clock failure and preserves a previously pending guest
exception. Timing stops after a clock failure; the profile does not silently
publish partial duration as valid evidence.

The focused regressions use controlled clocks and actual guest output to
exercise nested calls, recursion, slice budgets, snapshots, parked delegates,
manual CIL stepping and host/guest error priority. All 84 focused duration,
instruction-profile, method-event, cancellation and export tests passed serially
with Node 24.21.0 at `a25e66d3`. They establish no measured overhead, throughput
or cross-platform timing claim.
Browser, native .NET and Rust/Wasm comparisons remain pending.

Root owns the serial validation queue. The focused command was:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-profiler-duration-leaf.test.js tests/a05-instruction-profiler.test.js tests/a05-cil-method-events.test.js tests/a05-cil-method-events-cancellation.test.js tests/a05-10-profile-export.test.js
```

The example accepts `node examples/runtime/instruction-profile.mjs --duration`.
Record the commit, engine/version, options and environment when collecting real
timing evidence; run benchmarks alone on an otherwise quiet machine.

Recursive inclusive overflow regression: all six source/reload/CIL cases and
47 existing profiler cases passed serially with Node 24.21.0 at `52a0d249`.
Before the fix, all three recursive overflow cases failed while the three
finite nonrecursive controls passed. The failure stays outside guest dispatch.
