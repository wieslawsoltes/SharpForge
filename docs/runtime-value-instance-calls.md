# Direct user-struct instance calls

This bounded [T03.2 / #1365](https://github.com/wieslawsoltes/SharpForge/issues/1365)
increment executes nongeneric direct CIL instance methods and constructors on
the existing reference-free sequential user values. The receiver must be an
owned managed address with the exact declared struct type. Calls on locals,
array elements, nested fields and explicitly unboxed values reuse the existing
address path, storage-copy and field-resolution adapters.

Direct `.ctor` calls preserve initialized receiver fields that the constructor
does not write. A valid but uninitialized local of the exact type gets default
storage before its constructor executes. Ordinary methods still reject an
uninitialized receiver. Foreign, expired, readonly, inline-copy and incorrectly
typed receivers do not become writable locations as a side effect of admission.

`newobj` creates a temporary managed box containing an admitted default value
and passes its interior as `this`. The existing frame `returnObject` and argument
roots retain the box; a data-only `valueConstructor` marker requests a copied
inline result at return. Constructor faults return no value. Normal return,
unwind and stop drop these roots through the existing frame retirement path.
Ordinary same-VM snapshots capture the active constructor and can replay it.
No new VM fields, heap shapes or snapshot schema are introduced.

Temporary construction costs one managed box, and receiver admission currently
validates through a bounded struct copy. These are correctness mechanisms,
not throughput improvements; neither cost nor performance has been measured.
Boxing and immutable field normalization are reused without a new aggregate
representation. Class, Decimal and Nullable constructor paths remain separate.

Direct `callvirt` on an unboxed receiver, constrained, generic and byref-return
user-struct calls remain unsupported. The separate
[boxed interface-call leaf](runtime-boxed-interface-calls.md) adds nongeneric
concrete interface implementations. Existing reference-containing, readonly/ref-like,
auto/explicit-layout and scoped/modified-signature storage restrictions remain.
This does not add source custom-struct lowering, portable snapshots, raw memory
or reference-containing aggregate GC, and does not close #1365 or #1366.

Prepared guest-CIL regressions cover direct/repeated constructors, `newobj`,
copy isolation, nested calls, local/array/field/box receivers, actual collection
inside an instance method, wrong/null receivers, uninitialized locals, paused
constructor replay, return/stop/fault cleanup and both native ABI settings.
Host-entry negative cases cover readonly, foreign and expired addresses.
The former constructor-rejection test now asserts successful value construction
while retaining its prohibition on class-shaped struct allocation.

Serial Node 24 validation at `68d9123b` passed all 70 focused instance-call,
storage, boxing, Nullable, frame-pool, method-event and aggregate-quota tests.
The actual merged typed-frame and quota implementations are included. After
adding typed-frame/native-ABI receiver and GC combinations in `a80d1271`, all
10 instance-call tests passed again. Broad native/browser/performance
qualification remains deferred.

Focused command:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-value-instance-calls.test.js tests/a05-value-storage.test.js tests/a05-value-boxing.test.js tests/a05-nullable-cil.test.js tests/a05-frame-pool.test.js tests/a05-cil-method-events.test.js
```

The .NET 10 source fixture covers ordinary constructors, mutable calls through
locals/array elements/fields and box interiors. C# cannot spell a repeated direct
`.ctor` call on initialized storage; that case is covered by authored guest IL.
The fixture's `Unsafe.Unbox<T>` only expresses native box-interior access; no
runtime `Unsafe` intrinsic is added. `expected.txt` is an unmeasured target.

```sh
node scripts/limited.js dotnet run --project tests/fixtures/a05/value-instance-calls/ValueInstanceCalls.csproj -c Release
```
