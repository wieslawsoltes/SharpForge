# Opt-in CIL call-entry Wasm tiering

Pass `wasmTiering: true` or a limits object to `CilVirtualMachine` to count actual
method entries and taken loop back-edges, queueing compilation at either threshold. The option defaults
to disabled. It applies only to the JavaScript direct-CIL engine; source VM and
Rust execution do not use this policy.

```js
import {CilVirtualMachine, wasmTieringStatistics, disposeWasmTiering} from '@sharpforge/runtime';

const vm = new CilVirtualMachine(bytes, {wasmTiering: {callThreshold: 32}});
// Drive cooperative slices, yielding to the host between them as usual.
vm.runSlice({instructionBudget: 15000, timeBudgetMs: 8});
console.log(wasmTieringStatistics(vm));
disposeWasmTiering(vm);
```

When compilation becomes ready, a subsequent call selects the prepared method.
The call that triggered compilation, and every other already-entered frame,
continues interpreted by default. [Back-edge counters](wasm-backedge-counters.md)
can make a loop hot during that first invocation. Explicit `osr: true` also
allows the active invocation to select a ready method at a later hot back-edge,
as described below. Neither policy converts the canonical frame's storage.

Preparation uses the existing [eligibility/IR](wasm-ir-eligibility.md), encoder and
[manual runtime bridge](wasm-runtime-bridge.md). Analysis and binary encoding
start in a queued host microtask, within the limits below; native instantiation
uses the platform's asynchronous WebAssembly API. No worker is created. A
synchronous `vm.run()` that never yields does not gain a ready tier during that
host turn. There are no performance or cross-platform qualification claims here.

| Option | Default | Accepted range |
| --- | ---: | ---: |
| `callThreshold` | 32 | 1–1,000,000,000 |
| `backedgeThreshold` | 256 | 1–1,000,000,000 |
| `maxBackedgesPerMethod` | 64 | 1–1,024 |
| `maxMethods` | 64 | 1–1,024 |
| `maxConcurrentCompilations` | 1 | 1–4 |
| `maxMethodInstructions` | 4,096 | 1–65,536 |
| `maxAnalysisSlots` | 262,144 | 1–16,777,216 |
| `maxBytes` | 262,144 | 1–16,777,216 |
| `maxCompiledBytes` | 4,194,304 | 1–67,108,864 |

Numeric limits are integer host configuration, captured at construction; unknown
options and invalid values throw. Each bounded record belongs to an actual closed
method object in the current code generation. A method receives at most one
preparation attempt per generation. The queue cannot exceed `maxMethods`.
`maxBytes` bounds each emitted binary, and `maxCompiledBytes` bounds the sum of
retained binaries' byte lengths, not implementation-defined native machine-code
memory. Excess methods remain interpreted and increment `overflowCalls`.

`wasmTieringStatistics(vm)` returns `null` when not configured; otherwise it
returns frozen data rows with calls, queued/compiling/ready/fallback status,
bounded failure reasons and byte counts. `selectedCalls` and
`selectedInstructions` count dispatcher selections, not guaranteed native
operations: host instructions and failed operand guards retain their canonical
handlers. Compilation attempts and cancellations are lifetime counters;
per-method and selection counters restart when execution observes the next code
generation. Invalidated generation totals remain readable until then.
Method rows also include bounded per-edge counts and explicit site overflow.

Stop, restore, code-owner changes and explicit `invalidateExecutionCode` discard
derived selections and queued work. Metadata edits still require the established
code invalidation/reverification contract; in-place semantic edits are not
rescanned at each instruction. Report/body ownership changes cannot grant new
unchecked execution. Snapshots contain no modules, promises or tiering fields,
and restoring frames never increments call counts or selects them retroactively.

`disposeWasmTiering(vm)` disables automatic tiering for that VM and returns true
once, then false. Disposal in a host callback finishes the current imported
instruction before freeing its active import context. The platform has no
abortable instantiation API: canceled jobs retain their concurrency slot until
settlement, even across restore/edit generations, and cannot publish their result.
Compilation rejection, unsupported metadata and exhausted code capacity produce
fallback rows rather than guest faults. Existing instruction, stack, heap,
profiling, scheduling and debugger boundaries still run for every instruction.

Explicit `runWasmSlice` selection takes precedence over automatic selection;
its other methods remain interpreted. Ordinary slices continue calling an
overridden `vm.step`. No methods or functions are attached to pooled frames.
Serial Node 24 validation at `d1de978d` passed 76 of 78 focused tiering, bridge,
method-event, profiler, snapshot and typed-float tests. Two new fixtures left
test-only observer methods on the VM at snapshot boundaries; `27b32613` removes
them for capture/restore while preserving instruction and arithmetic assertions.
All nine call-tiering tests then passed. Broad native/browser qualification and
performance measurements remain deferred.

## Optional on-stack replacement

`wasmTiering: {osr: true}` enables an additional selection point, defaulting to
false. `osr` accepts only a boolean. After an individually hot source/target edge
executes successfully, an already-ready method can be selected for that same
active frame. The current VM, code/report/body ownership, frame id, target code
identity and incoming IR stack depth must match. Refusal leaves every operand
and the interpreter's next PC unchanged. Readiness alone never selects a frame:
compilation settling between host slices waits for the next taken hot edge.

This is a switch to the existing one-instruction Wasm dispatcher. The frame,
arguments, locals and evaluation stack retain their existing identity and
representation; no values stay resident in Wasm across instruction boundaries.
Native arithmetic guards still examine actual operands before consuming them.
Stack quotas, scheduler ticks, debugger callbacks and instruction accounting
remain in the existing outer execution envelope.

The next `onInstruction` callback observes the target before any compiled
instruction executes and can pause there. Single stepping still executes one
CIL instruction. A callback edit followed by code invalidation drops the
selection; per-instruction code/depth/operand guards continue to apply after
host callbacks. Restore drops all selections; disposal can disable tiering
without copying or replaying guest values. Manual `runWasmSlice` suppresses new
automatic OSR selections and retains its explicit dispatcher precedence.

Statistics add `osrTransitions` for accepted frame selections and
`osrRejectedEntries` for ready candidates whose target entry guard refused.
`selectedCalls` remains a call-entry count; `selectedInstructions` includes both
entry and OSR selections and does not imply that every operation ran natively.
When runtime events are enabled, each accepted OSR selection emits the existing
`TierUp` event with scalar payload `{kind: 'osr', method, frame, fromOffset,
toOffset, epoch}` and the current instruction count. Subscriber delivery uses
the existing deferred host flush boundary. A ready method selected on a new call
emits the same event name with `{kind: 'call', method, frame, epoch}`. This records
selection before the method's first instruction, not compilation completion or a
guarantee that every instruction will execute natively. The selection event precedes
that frame's `MethodEnter`; both use the existing caller instruction count. Cold,
failed and restored frames do not invent call-selection events. Host subscribers
run only at the existing flush boundary, and their failures remain host errors.
When runtime events are disabled, the optional call does not construct a payload.

Initial serial validation passed 27 of 28 focused call-tiering, OSR and method-event
tests at `9dd96a94`. The new restore fixture incorrectly expected immediate counter
reset; `209ec6e5` verifies unchanged call totals plus discarded compiled state instead.
All four call-entry event tests then passed. Required PR checks follow this local
validation. Broad event/platform qualification remains open.

All 63 focused OSR, back-edge, call-tiering, bridge, method-event and profiler
tests passed serially at `6a798e2e` on Node 24. Required PR checks follow this
local validation. Broad qualification and performance measurement remain pending. Debugger-requested forced
deoptimization ([#1408](https://github.com/wieslawsoltes/SharpForge/issues/1408))
is a separate surface; ordinary debugger boundary safety does not require
conversion because all live values already reside in canonical frame storage.
