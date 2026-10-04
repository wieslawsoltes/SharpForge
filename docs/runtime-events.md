# Bounded runtime events

`@sharpforge/runtime` exports `RuntimeEventLog` and the frozen `RuntimeEventName`
catalog. Construct a source, reloaded-source or direct-CIL VM with
`runtimeEvents: true` (or event-log options) to attach its automatic producers
and access the bounded log through `vm.runtimeEvents`. Creating a standalone
log provides manual storage/subscription only. Instruction profiling is a
separate option.

| Automatic event family | Source / reloaded source | Direct CIL |
| --- | --- | --- |
| MethodLoad, MethodEnter, MethodLeave | Implemented | Implemented |
| ExceptionThrown | Implemented | Implemented |
| AllocationTick, GCStart, GCEnd | Implemented | Implemented |
| Suspend, Resume | Implemented | Implemented |
| TierUp | No source tier producer | Implemented for actual Wasm tier entry / OSR |

The engine adapters preserve their documented admission and fault boundaries.
See [source method events](runtime-source-method-events.md),
[source method loads](runtime-source-method-load-events.md),
[CIL method events](runtime-cil-method-events.md),
[source exceptions](runtime-source-exception-events.md),
[CIL exceptions](runtime-exception-events.md),
[source heap events](runtime-source-heap-events.md),
[GC events](runtime-gc-events.md), [allocation events](runtime-allocation-events.md)
and [scheduler transitions](runtime-context-events.md).
Host observers remain outside guest snapshots and flush at host boundaries.

```js
import {RuntimeEventLog, RuntimeEventName} from '@sharpforge/runtime';

const events = new RuntimeEventLog({capacity: 4096});
const unsubscribe = events.subscribe(event => console.log(event.name, event.instruction));
events.emit(RuntimeEventName.MethodEnter, {method: 1, name: 'Program.Main'}, 0);
events.emit(RuntimeEventName.MethodLeave, {method: 1}, 25);
events.flush();
unsubscribe();
```

`emit(name, payload, instruction)` requires a known event name and a nonnegative
safe integer instruction count. Payloads contain at most 64 own fields with
JSON scalar values: string, finite number, Boolean or null. Keys are limited to
256 characters and strings to 16,384. Emission copies and freezes the payload;
managed references, functions and arbitrary host object graphs cannot enter
the event stream. Invalid events leave its sequence and history unchanged.

The ring retains the newest `capacity` events (1–1,000,000, default 4096), drops
the oldest on overflow, and counts all such drops. `read({after, limit})` returns
retained events after the sequence cursor in order. A subscriber sees future
events by default; `{replay: true}` includes retained history. The returned
unsubscribe function is idempotent, and an optional AbortSignal removes the
subscription. The subscriber limit is 1–4096, default 128.

Callbacks run only during `flush()`. Each flush snapshots the retained events
and current subscribers. Callback emission or new subscriptions wait until the
next flush; unsubscription prevents further delivery immediately. Recursive
flushes return without invoking callbacks again. Callback errors propagate to
the host, and a later flush can continue. Guest execution must invoke flush only
at a host boundary, outside managed exception dispatch.

`export()` produces structured-cloneable `SharpForge.RuntimeEvents/1` JSON with
instruction timestamps, ordered sequences and a drop count. The provider/name
vocabulary follows the planned EventPipe-shaped runtime stream; this is not the
binary EventPipe or `.nettrace` container and includes no measured wall-clock
time. Emission is O(1) in ring capacity with a bounded payload; flush is bounded
by retained events times current subscribers. None of these costs has been
measured in this implementation slice.

The original event-log prerequisite passed 22 event-log and value-ABI tests at `f3edb587`, including
a host adapter around real direct-CIL execution, ring overflow, immutable
payloads, cancellation/disposal, reentrant callbacks and malformed inputs:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
  node scripts/limited.js node --test --test-concurrency=1 \
  tests/a05-runtime-events.test.js tests/a00-01-value-abi.test.js
```

`npm run check` passed with 1,729 syntax-checked modules and no import errors.
The non-strict structure report completed with 264 repository warnings. Browser
runs and benchmarks remain staged. Automatic producers, the
[instruction profiler](instruction-profiler.md) and [Speedscope export](profile-export.md)
now have separate implementations and focused evidence in their linked docs.
Full E02 browser/platform, export-application and profiler-overhead qualification
remains open. The event ring is bounded history; cumulative suspension totals
come from the independent profiler counter.
