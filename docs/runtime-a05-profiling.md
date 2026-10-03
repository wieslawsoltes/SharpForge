# Deterministic execution profiles

`new VirtualMachine(image, {profile: true})` and `new CilVirtualMachine(bytes, {profile: true})` enable
`vm.profiler`. Without that option the field is null, allocation/collection observers are null, and no
profile records or event payloads are created. Disabled-path overhead remains unmeasured until the E02 gate.

The profiler records per-method calls, executed instruction/work-unit counts, allocation counts and bytes,
and inclusive instruction weights. Call-stack samples accumulate at a configurable instruction budget
and flush at call/return, context changes and slice boundaries. They count deterministic work, not elapsed
CPU time. All exported sample weights sum to the observed instruction count, including capacity overflow.
Recursion contributes each active occurrence of a method to its inclusive count.

The same bounded samples also accumulate elapsed milliseconds from a monotonic host clock. Each method
has `exclusiveMilliseconds` for its own sampled intervals and `inclusiveMilliseconds` for every active
occurrence on the sampled call stack. These are elapsed wall durations, **not CPU time**. Synchronous
GC, intrinsics and host callbacks inside a sampled interval contribute to it; pauses, waits, time between
slices and profile export with no active interval do not. Clock reads occur at sample starts and flushes,
not on every instruction. A budget flush retains a timing tail for the instruction about to execute.

`profile` also accepts `{sampleBudget, maxMethods, maxStacks, maxSites, duration, clock, events: {capacity, maxSubscribers}}`.
Duration sampling is enabled by default. `duration: false` keeps instruction-only profiling without clock
reads. `clock` is an injectable function returning finite, nonnegative monotonic milliseconds; it defaults
to `performance.now`. Malformed configuration or non-monotonic readings are rejected. No timer or
background sampler is created. The clock belongs to the profiler and is never copied into snapshots.
Profiler limits are integers from 2 to 1,000,000; event limits are documented by `RuntimeEventLog` and reject
zero. Reserved method entries retain runtime and capacity-overflow work. The event ring drops its oldest
entry when full and exposes `dropped`; method/sample/site overflow has separate counters. Object allocations
before the VM finishes host argument marshalling are outside the execution profile.

`vm.profiler.events.subscribe(callback, {replay, signal})` returns an unsubscribe function. Events are
delivered at the end of an execution slice, outside managed exception handling. A callback failure propagates
to the host. `read({after, limit})` provides sequence-based polling; `flush()` supports explicit host delivery.
Records use instruction counts as timestamps and the runtime-provider event names `MethodLoad`,
`MethodEnter`, `MethodLeave`, `ExceptionThrown`, `GCStart`, `GCEnd`, `AllocationTick`, `Suspend`, `Resume`
and `TierUp`. Tiering can contribute `TierUp` through the same event API.

`vm.profiler.export()` returns owned JSON data. `exportSpeedscope(vm.profiler)` follows the
[official Speedscope schema](https://www.speedscope.app/file-format-schema.json), with sampled profiles,
method names and `unit: "none"` instruction weights. Select `{metric: 'duration'}` for `unit: "milliseconds"`
and elapsed duration weights; requesting it on an instruction-only profile is an error. JSON keeps the
existing instruction clock and weights, adding `samples[].milliseconds`, `duration.totalMilliseconds`,
`duration.intervals`, and `overflow.stackMilliseconds`. The existing stack/method bounds also bound
duration data; overflow duration remains in the reserved sample rather than disappearing.
`exportRuntimeTrace(vm.profiler)` emits the
`SharpForge.RuntimeTrace/1` JSON event stream; it does not claim binary `.nettrace` compatibility.

These counters describe host observations. Restoring a VM snapshot retains the profiler and adds subsequent
execution to its totals rather than rewinding it. No profiler callbacks or managed references enter snapshots.

Run `node examples/runtime/profile.mjs cil > profile.json` to produce a Speedscope file. The example also
accepts `source` and `reload`, plus a second argument `duration` for elapsed-millisecond samples; program
output goes to stderr so stdout contains only the JSON profile.

| API/capability | Source VM | Reloaded source | Direct CIL | Status |
| --- | --- | --- | --- | --- |
| Instruction, call, allocation and suspension counters | Implemented | Implemented | Implemented | E02 qualification pending |
| Inclusive/exclusive sampled elapsed milliseconds | Implemented | Implemented | Implemented | E02 qualification pending; not CPU time |
| Bounded runtime event subscriptions | Implemented | Implemented | Implemented | E02 qualification pending |
| Speedscope and runtime trace JSON exports | Implemented | Implemented | Implemented | E02 qualification pending |
| Binary EventPipe / `.nettrace` output | Unsupported | Unsupported | Unsupported | JSON trace only |

`tests/a05-profiler-duration.test.js` adds deterministic injected-clock cases, timing tails, idle exclusion,
recursive/capacity accounting, snapshot/restore, stop and three-engine output parity.
`tests/a05-profiler.test.js` prepares on/off parity, three-engine counts, bounded overflow, event order,
subscriber lifecycle and snapshot observation cases. None has run during scope assembly. Disabled/on
overhead, cold/warm latency and p95/p99 remain part of the complete E02 qualification batch.
