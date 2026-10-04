# Boxed user-struct interface calls

This focused [T03.3 / #1366](https://github.com/wieslawsoltes/SharpForge/issues/1366)
increment lets direct CIL `callvirt` invoke a concrete nongeneric interface
implementation on a boxed reference-free sequential user struct. Both implicit
mapping and explicit `MethodImpl` mapping reuse the existing interface slots,
verified reachable-target check and virtual call-site cache.

Resolution and declaring-owner selection occur while the receiver is still
the original heap reference. Only afterward does the value adapter supply an
owned address into that same box. The normal direct-call receiver validation
checks the exact type, immutable payload and admitted layout. Virtual method
flags do not block execution of an already selected body; this step performs
no second reference dispatch and allocates no replacement box.

Mutating the implementation's `this` changes only the boxed copy. Another box
of the same type and the original unboxed value remain independent. GetType
and cast identity remain those of the original box. The existing byref roots
and frame snapshot/retirement paths retain the owner during GC, parked execution
and ordinary same-VM replay, then release it on return, fault or stop.

Generic interfaces/methods/structs, default-interface bodies on boxed structs,
constrained prefixes, readonly/ref-like values, unsupported layouts, source
custom-struct lowering and portable snapshots remain outside this increment.
Existing reference-class interface dispatch is unchanged. Full #1366 and its
native/browser/platform qualification remain open; no performance claim is made.

All 58 focused tests passed at `c74c3a9e`. Guest-CIL coverage includes implicit/explicit mappings, repeated calls through
the same cached site using distinct boxes, box/original copy isolation, type
identity, actual GC inside the body, replay, stop/fault cleanup, null and wrong
interface receivers, and default-interface rejection. Both enabled and disabled
inline-cache paths are exercised. No builds or native tools were run. Required PR checks follow the completed
serial local validation:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-boxed-interface-calls.test.js tests/a05-value-instance-calls.test.js tests/a05-value-boxing.test.js tests/a05-02-interface-dispatch.test.js tests/a05-inline-cache.test.js
```

The reference behavior corresponds to C# `IAdjust boxed = value; boxed.Bump(2);`
where `value` is a mutable struct implementing `IAdjust`. Its boxed payload
changes while `value` does not. Native differential execution is deferred.
