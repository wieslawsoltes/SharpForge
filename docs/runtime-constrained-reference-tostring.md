# Concrete reference constrained Object.ToString

The direct CIL engine accepts a concrete nongeneric internal class `TypeDef`
constraint followed by `callvirt System.Object.ToString(): string`. The owned
reference storage must exactly match the constraint; its live object may be a
compatible derived class. The runtime reads and roots that same reference, then
calls the actual inherited/overridden body or the existing Object.ToString
intrinsic. Neither path copies the object or allocates a receiver box.

Selection reuses the existing virtual slots. The first matching reuse-slot
declaration anchors Object's override chain. A newslot ToString, and overrides of
that new slot, do not replace Object's slot. An inherited override executes with
the original most-derived receiver. With no Object override, the intrinsic
returns its actual type name. Null retains the managed NullReferenceException;
foreign, expired, uninitialized and differently typed addresses remain rejected.

`ConstrainedReferenceObjectProfile(inspector, objects, dispatch)` is the shared
CIL metadata selector, where `objects` is `ConstrainedObjectProfile` and `dispatch`
is the existing `CilDispatchTable` adapter. `select(typeToken, descriptor)` returns
a frozen `{first, anchor, target, depth}` metadata plan or null for unsupported declarations
or hierarchies. `targets(typeToken)` returns a frozen array of possible descendant
targets for execution verification. Invalid/ambiguous metadata throws CilError.
The profile indexes parents/children once, caches type/descendant results, and
limits hierarchy depth to 64 and total indexing/selection work to 262,144 entries.
Runtime caches belong to the existing code epoch and contain metadata only.

Calls preserve normal pooled frame admission, receiver roots, initialization
gates, debugger offsets and ordinary same-VM snapshot/restore behavior.
[Base-bound generic reference calls](runtime-constrained-generic-tostring.md)
also reuse this selector. Unconstrained/class-only !0/!!0 parameters remain
excluded, as do generic receiver classes/bases,
external base chains other than System.Object, explicit Object MethodImpl,
interface constraints, and other Object members. General ordinary callvirt on an
external Object token is not broadened by this constrained-only leaf.

This partially advances #1357. Source frontend, native/browser qualification and
performance evidence remain open. Prepared guest-CIL regressions cover dynamic
and inherited overrides, newslot chains, no-copy/no-box fallback, warm invalid
receivers, GC callbacks, snapshot/stop/fault lifecycle and verifier reachability.
All 155 focused reference/struct/interface and generic-reference/value checks
passed at `fc934e85` with Node 24.21.0, one worker and a 512 MB old-space
limit. Broad native/browser/performance qualification remains deferred:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-constrained-reference-tostring.test.js tests/a05-constrained-object-tostring.test.js tests/a05-constrained-reference-calls.test.js tests/a05-constrained-generic-reference.test.js tests/a05-constrained-generic-value.test.js tests/a05-constrained-interface-calls.test.js
```
