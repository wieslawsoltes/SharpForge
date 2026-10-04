# Source synchronization contracts

Work item: SF-A05-T30 / #726.

The source compiler exposes the finite Monitor, Interlocked and Volatile profiles
already shared by the runtime and CIL verifier. Byref parameters keep their exact
declared type. Closed generic atomic calls emit a MethodSpec for the same byref
element type, and the assembly loader recognizes the corresponding source
builtin. Generic source overloads carry reference-type constraints.

`lock (expression)` evaluates its monitor once, initializes a Boolean `lockTaken`
slot, calls `Monitor.Enter(monitor, ref lockTaken)` inside the protected region,
and exits in `finally` only if acquisition succeeded. Nested locks use the same
logical scheduler-context identity. Return, throw and suspension use the normal
cleanup and scheduler paths; no host JavaScript mutex is introduced.

| Source capability | Runtime behavior | Regression |
| --- | --- | --- |
| Monitor Enter/Exit/IsEntered and lockTaken | Exact owned Boolean byref; reentrant cooperative ownership | `a05-monitor-flag-types.test.js`, `a05-source-synchronization.test.js` |
| `lock` | Single evaluation and conditional finally release | Source/reloaded-source/CIL cases in `a05-source-synchronization.test.js` |
| Interlocked scalar operations | One managed instruction and shared storage normalization | Same source suite |
| Generic Exchange/CompareExchange and Volatile Read/Write | Closed location/return types, explicit MethodSpec | Same source suite |
| Monitor queues across snapshots | Captured task, context and flag aliases; lazy component restore | `a05-06-control-replay.test.js` |

Run `node examples/runtime/synchronization.mjs` for a small source/CIL program.
The authored tests include wrong byref types, readonly flags, an already-true
lockTaken flag, unowned exit, null monitor, return/throw cleanup and generic
reference constraints. Validation of this new compiler connection is pending the
integration owner's serial slot. Native Wait/Pulse ping-pong comparison and
browser qualification remain separate acceptance obligations. This runtime models
cooperative managed contexts, not parallel host-thread memory access.

The C#13 `System.Threading.Lock` scope API remains an explicit unsupported source
profile; it is distinct from the Monitor-based lock contract requested here.

The retained native source in `tests/fixtures/a05/synchronization` combines the lock cleanup, scalar/generic atomic
and Wait/Pulse cases. Its two tasks use a shared turn under the monitor, making the `1`, then `2` output independent
of which native task starts first. `tests/a05-control-native-fixtures.test.js` checks the same complete source across
all three VM routes. The independent native command is:

```sh
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/synchronization --scheduled --output artifacts/a05-synchronization
```

The runner compiles the source once with the installed .NET SDK, compares that same DLL on native .NET and direct CIL,
and records source/assembly hashes and runtime versions. The fixture is authored; a passing native result is pending.
