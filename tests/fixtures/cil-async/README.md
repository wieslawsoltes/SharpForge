# Direct CIL task-builder probes

These source inputs are a pre-implementation boundary for Task/Task<T> state machines,
TaskAwaiter, and the actual .NET YieldAwaitable contract. They contain no authored
reference output. The driver builds each input with genuine Roslyn `-optimize-` and
`-optimize+`, runs each assembly on the installed .NET runtime, and compares the same
assembly on the direct CIL VM. It separately compares SharpForge output to that native
reference. A snapshot/restore control forks a suspended execution, and an invalid-body
control corrupts a MoveNext instruction reachable only through the builder ABI.

Source-only checkpoint: no baseline capture or execution has been performed. Run only
in the allocated serial validation slot:

```sh
node scripts/limited.js node --test tests/a05-cil-async-native.test.js
```

The test reports the actual SDK and reference pack. No result from legacy image-derived
compileToIL, source-VM async lowering, or native execution is counted as direct CIL VM
coverage. ValueTask, custom awaiters and async iterators are separate extensions.
