# Delegate target binding — T02.5 increment

Managed delegates now select their binding mode from the target and Invoke
signatures. A closed static delegate binds its first reference argument even when
that argument is null. Open static delegates pass invocation arguments unchanged;
closed instance delegates prepend their captured receiver; open instance delegates
consume the receiver from their Invoke arguments. Invalid receiver types, value-type
closed-static binding, incompatible signatures and foreign VM pointers are rejected
before delegate allocation. Null instance receivers fault at the ordinary call gate.

`ldftn` produces a verified VM-owned pointer whose identity is the resolved method
token. Delegate equality compares the delegate MethodTable, method token, binding
mode and receiver identity. It never compares receiver contents. Framework event
removal and supported guest `Equals(object)` calls share that comparison.

`execution/delegate-targets.js` adapts the E01 delegate model to main's current
platform and scheduler. Direct Invoke and queued callbacks share argument preparation,
then use the existing call/return and initialization paths. Delegate binding state
is ordinary heap data; snapshots preserve it without a new VM field. Existing source
compiler delegates retain their original static/closed-instance representation.

The CIL package exports `managedDelegateSignature` and `supportedDelegateCall` from
its package entry. They define the shared constructor/Invoke/Equals profile for
registered framework delegates, closed Action/Func forms and declared delegate
Invoke signatures. This metadata seam is separate from generic method execution.
Standard arities are nongeneric Action, Action with 1–16 type arguments, and Func
with 1–17 type arguments. Malformed arities are rejected before registry alias lookup.

This PR is a partial T02.5 increment. Multicast Combine/Remove, invocation-list return
semantics, `ldvirtftn`, generic method pointers, value-type instance binding and
managed `calli` remain separate dependent batches. Their existing verifier limits
are retained. Source syntax for these new binding forms is outside this runtime slice.

The binding rules reuse E01 commit `9f663bea` and follow the .NET 10
[delegate implementation](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/System.Private.CoreLib/src/System/Delegate.CoreCLR.cs).
`tests/a05-delegate-targets.test.js` provides independently assembled CIL and API
regressions for binding, equality, null/error boundaries, scheduled arguments and
snapshot replay. Validation is queued with the integration owner; this slice has
not executed tests, builds, native programs, browser gates or benchmarks. No new
performance or platform qualification is claimed.

The draft now includes the small-integer storage prerequisite at `0578b6ef`.
Delegate binding still prepares the receiver and argument order first; the shared
call gate then normalizes each argument against the resolved target signature
before creating its frame. Immediate and scheduled delegate invocations use that
same gate. This integration merged without textual conflicts; its combined
behavior has not yet been executed or validated.

The integration owner will run these focused regressions in the sole serial slot:

```sh
node --max-old-space-size=512 --test --test-concurrency=1 \
  tests/a05-delegate-targets.test.js tests/a05-t01-small-storage.test.js \
  tests/a05-seams-numeric.test.js tests/managed-il.test.js
```

They cover delegate binding/equality and snapshot scheduling, destination and
argument normalization, numeric helpers, and ordinary independently assembled IL.
