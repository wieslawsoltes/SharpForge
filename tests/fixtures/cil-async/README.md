# Direct CIL task-builder probes

These source inputs are a pre-implementation boundary for Task/Task<T> state machines,
TaskAwaiter, and the actual .NET YieldAwaitable contract. They contain no authored
reference output. The driver builds each input with genuine Roslyn `-optimize-` and
`-optimize+`, runs each assembly on the installed .NET runtime, and compares the same
assembly on the direct CIL VM. It separately compares SharpForge output to that native
reference. A snapshot/restore control forks a suspended execution, and an invalid-body
control corrupts a MoveNext instruction reachable only through the builder ABI.

The frozen pre-fix head `d6051bff9a29c21b31d6911f3bf5216d2001ce95` ran six tests: zero passed,
six failed, zero skipped. Five failed at missing builder/awaiter admission. The sixth
failure came from the invalid-body assertion, but post-fix investigation found that its
original mutation used absent described-method offsets and did not alter the image.
That original result does not independently establish callback-body rejection. The
corrected control mutates the actual PE method body and passed post-change qualification.
A separate genuine Roslyn
capture executed all eight Debug/Release programs successfully, confirmed class versus
struct state machines, and recorded CIL admission rejection for every image. See
[qualification/pre-fix.json](qualification/pre-fix.json) for outputs, hashes, tool versions
and actual diagnostics. At executable commit `974a5621bc59088b20b63034306e35b3af2a2122`,
16 focused tests passed, including six native inputs in both Roslyn optimization modes
and six independently emitted SharpForge executions. The 67 adjacent checks passed;
33 of 34 separate dispatch checks passed, with one unresolved existing wording expectation.
See [qualification/post-fix.json](qualification/post-fix.json) for exact commands, times,
source identity and failed/successful raw logs. Performance measurements remain pending.

Run only
in the allocated serial validation slot:

```sh
node scripts/limited.js node --test tests/a05-cil-async-native.test.js
```

The test reports the actual SDK and reference pack. No result from legacy image-derived
compileToIL, source-VM async lowering, or native execution is counted as direct CIL VM
coverage. ValueTask, custom awaiters and async iterators are separate extensions.

`WaitAndDelay.cs` and `Mutation.cs` are additional review controls qualified in both modes.
They check Wait/Result aggregate failures versus await exception identity, Delay's -1,
zero, Int32.MaxValue and invalid-negative boundaries, and replacement of a reference
field in a suspended Release state machine. The snapshot test additionally requests a
collection at every managed allocation. These are not included in the recorded eight
pre-fix native outputs.

`GenericMethod.cs`, `GenericOwner.cs`, and `GenericAggregateBoundary.cs` are additional
source-only controls. No compiler, native or VM execution has been recorded for them.
They separate generic method and nested owner substitution from the documented user
aggregate payload boundary. `generic-boundaries.json` records their intended scope and
the additional malformed-metadata controls still needed. They do not expand this ABI
contribution to custom builders, ValueTask or custom awaiters.

The capture driver accepts an explicit checked-in fixture list and `--execute` to record
the same real Roslyn images on the CIL VM. It records the actual outcome; a capture is
not itself a pass claim for these uncaptured boundaries.

```sh
node scripts/limited.js node tests/fixtures/cil-async/capture.mjs <output-directory> \
  GenericMethod GenericOwner GenericAggregateBoundary --execute
```
