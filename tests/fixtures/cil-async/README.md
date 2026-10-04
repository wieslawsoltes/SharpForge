# Direct CIL task-builder probes

These source inputs are a pre-implementation boundary for Task/Task<T> state machines,
TaskAwaiter, and the actual .NET YieldAwaitable contract. They contain no authored
reference output. The driver builds each input with genuine Roslyn `-optimize-` and
`-optimize+`, runs each assembly on the installed .NET runtime, and compares the same
assembly on the direct CIL VM. It separately compares SharpForge output to that native
reference. A snapshot/restore control forks a suspended execution, and an invalid-body
control corrupts a MoveNext instruction reachable only through the builder ABI.

The frozen pre-fix head `d6051bff9a29c21b31d6911f3bf5216d2001ce95` ran six tests: zero passed,
six failed, zero skipped. Five failed at missing builder/awaiter admission; the invalid-body
control confirmed that MoveNext was not reached by verification. A separate genuine Roslyn
capture executed all eight Debug/Release programs successfully, confirmed class versus
struct state machines, and recorded CIL admission rejection for every image. See
[qualification/pre-fix.json](qualification/pre-fix.json) for outputs, hashes, tool versions
and actual diagnostics. No post-implementation runtime result has been claimed.

Run only
in the allocated serial validation slot:

```sh
node scripts/limited.js node --test tests/a05-cil-async-native.test.js
```

The test reports the actual SDK and reference pack. No result from legacy image-derived
compileToIL, source-VM async lowering, or native execution is counted as direct CIL VM
coverage. ValueTask, custom awaiters and async iterators are separate extensions.

`WaitAndDelay.cs` and `Mutation.cs` are additional, currently unexecuted review controls.
They check Wait/Result aggregate failures versus await exception identity, Delay's -1,
zero, Int32.MaxValue and invalid-negative boundaries, and replacement of a reference
field in a suspended Release state machine. The snapshot test additionally requests a
collection at every managed allocation. These are not included in the recorded eight
pre-fix native outputs.
