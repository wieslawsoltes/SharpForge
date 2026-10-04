# A05 constrained Object slots

Work item: SF-A05-T02 / Project 7 issue #1357.

Direct CIL selects the exact ordinary `System.Object.ToString()`,
`Equals(object)`, and `GetHashCode()` slots. A same-named overload, a new virtual
slot, an explicit-this signature, or an unsupported MethodImpl does not become an
Object override. Selection uses the existing dispatch table and is cached by code
epoch, declaring definition, and Object member.

The admitted receiver categories are Int32, Int64, UInt64, supported sequential
user structs, and internal reference hierarchies. Closed generic structs and
classes preserve their exact declaring instance. `!n` and `!!n` substitutions
validate their complete runtime generic constraints, and runtime storage must
match the constraint's exact owned MethodTable. Open storage, foreign or expired
addresses, uninitialized receivers, and unsupported readonly receiver calls fail
before operands are consumed.

An integer calls its builtin value implementation without boxing its receiver.
A user struct override receives its original managed address and closed generic
owner. A struct inheriting the default Object slot boxes a copy. A reference
constraint dereferences its owned slot and dispatches using the actual runtime
type, including a previously boxed value stored in an Object slot. Generic type
names use CLR square-bracket display syntax independently of cache identity keys.

Default value equality requires the same actual boxed type and compares fields in
metadata order. Managed field overrides run as ordinary VM calls. Default hashing
combines type identity and field hashes into a signed 32-bit result. Equal values
receive equal hashes; default composite, string, and reference hash numbers are
not a portable CLR numeric contract. Int32 and 64-bit integer hash results follow
their builtin bit operations exactly.

Field walks and string processing execute in bounded native quanta. Every
subsequent quantum consumes an instruction budget unit and passes through normal
scheduler, profiler, cancellation, and fault boundaries. Managed overrides keep a
data-only `objectValueContinuation` on their callee. Native work keeps an
`objectValueWork` on its original caller. All outstanding operands and temporary
boxes participate in the shared root inventory. Tail calls preserve managed
continuations; exceptional retirement abandons them.

`beginObjectEquals(vm, left, right, {capture: true, type})` is the internal array
search seam. It returns an i4 Boolean immediately or the existing `SUSPENDED`
sentinel. A later captured result is delivered to the original live caller's
`objectValueResult`, without changing its evaluation stack. No callback or host
closure is stored in replayable state.

`Array.IndexOf` uses the captured equality seam for reference and aggregate
elements. The cursor remains on the current element while its override runs;
native work and managed return delivery resume before the next comparison. A
throw abandons the search, while a callback that catches its own fault retains its
outer equality continuation. Scalar array searches keep their existing bounded
typed-storage path. Synchronous host array helpers complete default comparisons
and reject a custom managed override before entering it; guest execution uses the
cooperative call path.

The new focused matrix covers concrete and generic integer/struct/class calls,
closed generic owners, results, receiver-box allocation counts, mutations through
original addresses, exact hidden-slot behavior, foreign receivers, and generic
constraint rejection. The continuation matrix covers managed field calls, native
work yields, instruction charging, GC, snapshot replay, exceptions, and stop.

Earlier tests intentionally asserted the smaller ToString-only admission profile.
Those boundaries now assert supported TypeSpecs, generic primitives, generic class
owners, reference-bearing structs, and the added Object slots. Their address,
layout, calling-convention, type-variable, and generic-constraint negative checks
remain. A valid symbolic generic body is admitted independently of a later closed
call whose type argument violates its declared constraints.

Reference contracts:

- [ECMA constrained call behavior in the .NET API documentation](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.opcodes.constrained?view=net-10.0).
- [ValueType.Equals field equality contract](https://learn.microsoft.com/en-us/dotnet/api/system.valuetype.equals?view=net-10.0).
- [ValueType.GetHashCode contract and implementation variability](https://learn.microsoft.com/en-us/dotnet/api/system.valuetype.gethashcode?view=net-10.0).

The shared serial repair run at
`66898966b6148ebdcf7bff293774ba159f9dc647` passed the Object, constrained-call,
boxed/value instance, source Object slot, prepared-call quota, restored field-cache,
and MethodTable regression groups. The [unaltered aggregate log](a05-object-slots-validation-66898966.log)
contains 509 tests: 505 passed and four failed in other assigned repair groups
(generic aggregate dispatch, exception event policy, exception hierarchy, and
ambiguous source-interface metadata). It is not an all-green integration result.
The run used the shared Node 24 serial validation slot; a final integrated-head
rerun and independent native/browser/Wasm qualification remain pending.

A focused reproduction command for the Object contract is:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-constrained-object-slots.test.js tests/a05-object-value-continuations.test.js tests/a05-source-object-slots.test.js tests/a05-array-object-equality.test.js
```

Source images carry exact `objectSlot` identities, emitted as ordinary CLI virtual
override MethodDef flags and reconstructed from those flags when the assembly is
reloaded. Existing source MethodTables retain the slots alongside ordinary method
ids. Source, reloaded source, and direct CIL use managed calls for class and boxed
struct overrides. Direct source struct calls, including calls bound to Object
declarations, select the exact struct override before boxing. Writable locals,
fields and parameters retain their original managed address; `in` and readonly
receivers use a defensive temporary. Hidden same-named methods do not replace an
Object slot. Closed generic structs and type-parameter calls select their exact
source override through the same ordinary managed call path. Existing
restrictions on converting a monomorphized generic source type to
Object remain until its public runtime type identity is represented faithfully.

The source matrix includes hidden methods, default struct equality, null faults,
boxed copy mutation, and managed field callback snapshot replay. Native/Wasm
execution of these managed Object operations has not been qualified by this
batch; they are not reported as passing.

Unhandled exceptions retain the first-pass frames and original receiver storage
for inspection. Those frames remain GC roots. `stop()` retires their addresses,
clears scoped memory, and releases temporary boxes; a caught exception unwinds
through the ordinary managed handler path. Regression cases verify both retained
receiver liveness before stop and invalidation/collection afterward.
