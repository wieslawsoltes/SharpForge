# Automatic direct-CIL method events

Pass `runtimeEvents: true` or event-ring options when constructing a
`CilVirtualMachine`. The `vm.runtimeEvents` getter returns its `RuntimeEventLog`,
or `null` when disabled. Disabled execution creates no observer/log, method
records or event payloads. It still performs the small opt-in guard at the call,
return and slice seams; no measured zero-overhead claim is made.

```js
import {CilVirtualMachine} from '@sharpforge/runtime';

const vm = new CilVirtualMachine(assemblyBytes, {runtimeEvents: {capacity: 4096}});
const unsubscribe = vm.runtimeEvents.subscribe(event => console.log(event), {replay: true});
try { vm.run(); }
finally { unsubscribe(); vm.stop(); }
```

`MethodLoad` is emitted once per observed method object, including its MethodDef
token and full name. Each admitted frame emits `MethodEnter` with its unique
frame identifier. Normal return emits `MethodLeave`; exceptional
unwind, discarded cooperative frames and explicit stop carry corresponding
`reason` values. Retained fault/debugger frames remain open until discarded or
stopped. Intrinsic helpers without managed frames do not invent method events.
Parked cooperative frames stay open while waiting. When scheduler cancellation
discards their stacks, the next host slice closes the missing frames with
`reason: 'canceled'`, innermost first. Repeated reconciliation and later stop do
not emit another leave for those frames. A normal wake-up instead emits ordinary
returns when the methods complete.

VM construction records the initial entry and initializer calls before a host
can subscribe. Use `{replay: true}` to receive that retained history. Callbacks
flush at the end of `runSlice`, including debugger pauses and waiting states,
and after stop has completed cleanup. They run outside the managed instruction
exception boundary: subscriber exceptions propagate to the host without
becoming guest exceptions. Manual `step()` only enqueues events; its host can
call `vm.runtimeEvents.flush()` at an appropriate boundary.

The log, loaded-method identities and subscriptions live in weakly VM-owned
host state, outside snapshots. Restore retains the same log and sequence,
closes previously observed spans with `reason: 'restore'`, and opens restored
frames with that reason. Replay therefore adds observations instead of deleting
history. Instruction timestamps are the VM counter at emission and can move
backward after restore; event sequence numbers stay strictly increasing. This
is an event log, not a cumulative instruction profiler. Failed restore does
not change the event observer.

| Surface | Status |
| --- | --- |
| Direct-CIL MethodLoad/Enter/Leave | Implemented, opt-in |
| Bounded replay/subscription API | Uses `RuntimeEventLog`; see `runtime-events.md` |
| Source/reloaded engines, exception/GC/allocation/tier events | Separate integration work |
| Cooperative context identifiers | Deferred until context identity is assigned before frame admission |
| Profile sampling/totals and speedscope export | Separate T10 work |
| Native/browser qualification and overhead measurements | Not performed for this slice |

The serial slot passed 63 tests at `23f28b6e`, covering actual calls, exceptional
unwind, output/instruction equivalence, debugger pause, stop, overflow, malformed
configuration, callback failures, snapshots, delegate integration and the value
ABI. Independent CIL schedules a real `Task.Run(Action)` delegate, parks its
nested call in `Thread.Sleep`, then verifies cancellation and natural virtual-time
wake-up. Discarded frames close inner-first, exactly once, without continuation
side effects.

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_TEST_CONCURRENCY=1 SHARPFORGE_MAX_OLD_SPACE_MB=512 \
  node scripts/limited.js node --test --test-concurrency=1 \
  tests/a05-cil-method-events.test.js tests/a05-cil-method-events-cancellation.test.js \
  tests/a05-runtime-events.test.js tests/a05-delegate-targets.test.js tests/a00-01-value-abi.test.js
```

`npm run check` passed (1,829 syntax modules, no import errors). The non-strict
structure report completed with 264 repository warnings. Final main integration
at `f4696f74` resolves the stacked merge ancestry; it changes no runtime, bytecode,
CIL or focused test files. No native/browser qualification or performance
measurement was performed.
