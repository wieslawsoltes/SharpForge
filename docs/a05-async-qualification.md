# A05 async state-machine qualification

`tests/a05-29-async.test.js` assembles an independent CLI state machine with two actual `MoveNext` suspensions and a finally region.
The tests cover completion, fault propagation, cancellation, default and copied builders, awaiter callbacks, and invalid snapshots.
They exercise the interpreter's normal call, value storage, scheduler, and exception paths.

The native acceptance fixture is `tests/fixtures/a05-async/Program.cs`. Compile and execute the same Roslyn-produced DLL on .NET and
the CIL interpreter with:

```sh
node scripts/validate-a05-type-system.js --async --fixture tests/fixtures/a05-async --output artifacts/a05-async
```

The `--async` runner records local and portable snapshots at the first two awaits of the same state machine, completes the original execution,
cancels and collects its heap, then restores each snapshot locally and into a fresh VM. All replays must retain the same output and exit code,
including exactly one execution of the finally block. Evidence records the native command, source and assembly hashes, original
execution, and every replay outcome. The fixture also covers awaited failures, async void completion, `Task.Yield`, a generic async method,
and full and early iterator disposal. `tests/a05-29-iterator-dispatch.test.js` independently checks verified external interface slots,
portable replay, and rejection of mismatched, foreign, or duplicate explicit implementations.

This qualification requires an installed .NET SDK and runtime. Missing SDKs are an environment limitation and are not a passing result.
Source-compiled async methods use the compiler's own scheduler lowering; their source/reloaded-source/CIL replay coverage remains in
`tests/a05-06-control-replay.test.js`. Custom awaiter types and ValueTask awaiters are outside this finite CIL infrastructure profile.
