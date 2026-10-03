# SF-A05-T11 Wasm tier-1

The opt-in CIL tier generates real Wasm integer and floating-point arithmetic.
Each native entry executes exactly one CIL instruction. Every return synchronizes
with the ordinary frame; budget accounting, sequence points, scheduler turns and
instruction GC continue through the existing interpreter loop. Long-running loops
can switch to a ready module at an executed backward branch target without returning
from their method. Entry switching and loop OSR have separate observable counters.

This implementation is assembled but not qualified. No T11 tests, benchmarks,
browser or native runs have been performed by this workstream. Validation belongs
to the integration owner's serial E02 queue. Per-instruction JS/Wasm crossings may
cost more than the native arithmetic saves; no speedup or platform pass is claimed.

| Capability | Direct CIL | Source and reloaded source |
| --- | --- | --- |
| Verified typed IR; i32/i64/f32/f64 add, subtract, multiply, negate, integer bitwise/shift | Wasm | Existing interpreter |
| Checked arithmetic, conversions, comparisons, division, branches, calls | Existing authoritative handlers imported by Wasm | Existing interpreter |
| Fields, arrays, allocation, reference stores, volatile fields | Managed-heap imports using existing handlers/barriers | Existing interpreter |
| Call counters, asynchronous compilation, method-entry switch, live-loop OSR | Implemented, opt-in | Interpreter fallback |
| Budgets, debugger stops, GC, snapshots, cancellation | Existing instruction boundary preserved | Existing interpreter |
| EH regions, byrefs, indirect memory, value-type locals, native-int locals | Explicit method fallback | Existing interpreter |

The initial profile rejects unverified or replaced method bodies, unsupported
storage and pointer instructions, methods with EH regions, and methods with no
native arithmetic/constants. Each rejection has a stable `WASM_*` diagnostic in
the preparation report and tier statistics. Eligibility is not a second verifier:
it reuses verified method membership, stack effects and conservative numeric flow.

## Public API

Construct `CilVirtualMachine` with `wasmTiering:true` or an options object:

```js
const vm = new CilVirtualMachine(assembly, {
  wasmTiering: {callThreshold: 32, backedgeThreshold: 256}
});
await prepareWasmTier(vm); // optional deterministic entry prewarming, no IL execution
const result = await vm.runAsync();
const tier = wasmTierStatistics(vm);
```

`prepareWasmTier(vm, methodOrToken = vm.top.method)` returns a preparation status,
fallback reason and eligibility report. Method tokens resolve to the same closed
method cache used by calls. Open generic methods require a supplied closed method.
`deoptWasmTier(vm, reason)` drops tier membership at the current canonical PCs,
including parked scheduler contexts. `wasmSafepoint(vm, frame = vm.top)` returns
immutable arrays of the current arguments, locals and evaluation values plus the
frame ID, method token and PC. These are managed values, not portable JSON.
`disposeWasmTier(vm)` releases native entries and prevents in-flight publication
until code invalidation starts a new epoch. Existing edit/restore/stop epoch
invalidation makes compiled state unusable; it never enters snapshots or frames.

`wasmTierStatistics` reports compilations, pending/failed compilation, binary bytes,
native and bridge instruction counts, entry and OSR transitions, deoptimizations,
per-method call/backedge counts and fallback reasons. It exposes no executable
objects. Options also bound `maxMethods` (64), `maxMethodInstructions` (4096) and
`maxConcurrentCompilations` (2). Capacity exhaustion retains interpreter execution.

`backedgeThreshold` applies to one executed source/target edge, including separate
destinations of a `switch`; untaken backward branches do not count. Unrelated loops
do not combine their counts to meet it. `methods[].backedges` remains the aggregate
number for compatibility. New `backedgeSites` rows contain `fromOffset`, `toOffset`
and `count`, sorted by source then target IL byte offset. Both the rows and returned
array are immutable copies. A self-edge at the same offset counts as a backedge.

`maxBackedgesPerMethod` defaults to 1024 and accepts integers from 1 through 65536.
Only executed edges allocate counters; warm hits use numeric nested-map lookups.
When the cap is reached, existing sites continue counting. Executions of omitted
sites increment `backedgeOverflow` and the aggregate, without allocating more
site records. Such omitted edges cannot independently trigger compilation, while
the method call threshold remains available. Thus the sum of retained site counts
plus overflow equals the aggregate. All these derived counters reset with the code
epoch on restore, edit or stop; none enter snapshots.

Encoding is bounded and scheduled through a promise; actual module compilation
uses asynchronous `WebAssembly.instantiate`. Synchronous `run()` cannot service
promise completions during a long loop. Use `runAsync()` for background OSR or
await preparation before synchronous execution. CSP that blocks Wasm compilation
produces `WASM_COMPILE` fallback. There is no `eval`, generated JavaScript, Worker
process, linear-memory heap copy or new host capability.

Crossing a hot threshold requests compilation at that instruction. A free
compilation slot is required; a busy slot is retried while the method executes.
The threshold does not guarantee completion within that many guest instructions
or a host time limit.
`runAsync()` yields through host timers between running slices, allowing queued
encoding and native asynchronous compilation to progress while later slices
continue interpreting. The first executed backward target after code becomes
ready can enter the tier. A short method or synchronous `run()` can finish before
compilation completes, producing no OSR. This is JavaScript event-loop scheduling,
not a dedicated compiler thread managed by this runtime. Native engine scheduling
and CSP availability determine when or whether the code becomes ready.

## Heap and deoptimization contract

Only primitive operands leave the managed evaluation stack during native
arithmetic. Before heap imports, all references remain in the ordinary rooted
frame. Imports call the current decoded CIL handlers, preserving allocation pins,
reference validation, array covariance, `writeData`/`ensureWritable`, snapshot
mutation versions and write notifications. Managed exceptions propagate once;
an instruction with effects is never retried as a deoptimization fallback.

All Wasm temporaries are consumed within one IL entry. Thus the deopt map is the
canonical frame at every instruction rather than a second shadow-local format.
The existing debugger callback executes before native entry, the existing budget
counter counts one instruction, and GC runs after the same boundary. No Wasm
function, module, active import context or frame reference is serialized.

### Automatic debugger deoptimization and tier events

The CIL `state` accessor deoptimizes all active and parked tiered frames when the
state changes to `paused`. This covers source/IL/function breakpoints, stepping,
run-to-cursor and IL `break` through the debugger's instruction callback; data
breakpoints raised inside a managed write; first-chance exception stops; manual
pause from running or waiting; and a host's direct `vm.state = 'paused'` assignment.
Repeated assignment while already paused does not add deoptimizations. Snapshot
restore still captures the public state and invalidates compiled code; observer
state and native functions stay outside the snapshot. Resume uses canonical
interpreter values and may re-enter a compiled loop at its next backward target.

With `profile: true`, a real compiled method entry or loop OSR records `TierUp`.
Its flat payload contains the profile method ID, MethodDef `methodToken`, `frame`,
`kind` (`entry` or `osr`), `ilOffset` and code `epoch`. Prewarming, fallback,
disposed code and rejected frame shapes emit no transition event. Subscriber
delivery stays at the existing host slice boundary; the tier does not call host
subscribers from native imports. With profiling disabled it constructs no tier
event payload. The existing profiler's instruction clock remains cumulative.

`tests/a05-wasm-debug-events.test.js` prepares real debugger breakpoint, write,
step, manual pause, exception, snapshot and entry/OSR event regressions. It also
covers repeated pauses, disposal, fallback and prototype-based state access.
No execution or overhead measurement was performed for this patch. The root's
single-worker queue runs it alongside `tests/a05-wasm-tiering.test.js` and
`tests/a05-profiler.test.js`. Source/reloaded engines have no Wasm tier; this patch
does not extend their backend. Browser/platform qualification, latency and
allocation measurements, and the remaining full T10/T11 acceptance stay pending.

The encoder follows the primary WebAssembly
[module format](https://webassembly.github.io/spec/core/binary/modules.html),
[instruction encodings](https://webassembly.github.io/spec/core/binary/instructions.html),
and [JavaScript instantiation API](https://webassembly.github.io/spec/js-api/index.html#instantiation).
It emits type, import, function, export and code sections directly with LEB128
operands and little-endian IEEE constants. No native compiler toolchain is needed.

## Prepared evidence

`tests/a05-wasm-*.test.js` covers IR eligibility, actual `WebAssembly.validate`,
seeded native arithmetic differentials against shared numeric semantics, signed
zero/NaN, entry and loop OSR, exact budget/fault PCs, debugger locals, snapshot
replay, cancellation, code epochs, field/array mutation and instruction GC.
Run `node examples/runtime/wasm-tier.mjs entry` or `osr` for a runnable example.
These commands have not been executed for this slice.

T12 will measure cold encoding/instantiation and warm execution separately, record
median/p95/p99, JS allocations and Wasm binary bytes, and compare the same verified
workloads with tiering disabled. Actual OS/browser/engine versions and fallback
reasons must accompany measurements. A prewarmed entry run cannot substitute for
the independent live-loop OSR regression.

`tests/a05-wasm-backedges.test.js` adds per-edge threshold isolation, distinct
switch destinations, capacity/invalid bounds, untaken and self-edge boundaries,
restore/cancellation, opt-out, and an automatic `runAsync()` long-loop regression.
That regression never calls `prepareWasmTier`: it checks real pending compilation,
OSR while the method is still running, TierUp delivery, and interpreter-equivalent
stdout, result and instruction count. It is prepared, not executed. The root's
serial queue must qualify it on each affected host; no latency or speedup is
inferred from a successful functional transition.
