# Bounded runtime events

`@sharpforge/runtime` exports `RuntimeEventLog` and the frozen `RuntimeEventName`
catalog. This independent T10.2 prerequisite supplies event storage and host
subscription. Automatic VM call, exception, allocation, GC and tiering hooks are
separate integration work; creating a log does not enable profiling on a VM.

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

`export({after, limit})` produces structured-cloneable `SharpForge.RuntimeEvents/1` JSON with
instruction timestamps, ordered sequences and a drop count. The provider/name
vocabulary follows the planned EventPipe-shaped runtime stream; this is not the
binary EventPipe or `.nettrace` container and includes no measured wall-clock
time. Emission is O(1) in ring capacity with a bounded payload; flush is bounded
by retained events times current subscribers. None of these costs has been
measured in this implementation slice.

Export cursor options use the existing `read()` rules; omitting them preserves
the full retained window. The named
[`exportRuntimeTrace(log, options)` helper](runtime-trace-export.md) exposes the
same bounded operation without flushing subscribers. Whole-log sequence/drop
metadata is preserved even when only a smaller event window is returned.

Serial validation passed 22 event-log and value-ABI tests at `f3edb587`, including
a host adapter around real direct-CIL execution, ring overflow, immutable
payloads, cancellation/disposal, reentrant callbacks and malformed inputs:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
  node scripts/limited.js node --test --test-concurrency=1 \
  tests/a05-runtime-events.test.js tests/a00-01-value-abi.test.js
```

`npm run check` passed with 1,729 syntax-checked modules and no import errors.
The non-strict structure report completed with 264 repository warnings. Browser
runs and benchmarks remain staged. Automatic hooks, profile totals, speedscope
export and profiler overhead remain in the original E02 acceptance scope.
