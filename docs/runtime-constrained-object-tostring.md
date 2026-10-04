# Concrete struct constrained Object.ToString

The direct CIL engine admits `constrained. <TypeDef>; callvirt
System.Object.ToString(): string` for nongeneric internal reference-free sequential
structs. A public virtual reuse-slot override receives the original owned managed
address. Its writes affect that storage without allocating a receiver box. If the
struct inherits the implementation, the runtime boxes a copy and invokes the
existing Object.ToString intrinsic, producing the canonical type name. A newslot
method with the same name does not override Object.ToString.

The CIL public `ConstrainedObjectProfile(inspector).select(typeToken, descriptor)`
shares exact declaration and override selection with execution. It returns a
frozen `{target, initializers}` metadata plan, or null outside the admitted shape;
ambiguous or explicit Object MethodImpl overrides throw `CilError`. Verification
visits the selected body and initializer, including the inherited fallback case.
Runtime plans belong to the execution code epoch and contain no heap references;
restore, code replacement and stop discard the derived cache as usual.

Both paths validate exact live VM-owned storage, preserve initializer retry
operands, and use existing pooled arguments, frame roots and snapshot behavior.
The fallback box is explicitly rooted across formatting callbacks and result
allocation. Readonly and uninitialized receivers remain rejected. Prefixes retain
their existing debugger-visible offsets and branch/exception-region boundaries.

This is one increment of #1357. Explicit Object MethodImpl, generic receivers or
constraints, generic structs, primitive/enum/class receivers, other Object
members, reference-containing/auto/explicit layouts, readonly/ref-like structs,
and source frontend lowering remain outside this leaf. Existing generic struct
interface-forwarding support remains bounded to its interface declarations.
Full issue acceptance, native/platform qualification and performance evidence
remain pending; this change makes no timing claim or portable snapshot claim.

Prepared guest-CIL tests cover both decode modes, boxing counts, override writes,
copy isolation, fallback GC rooting, initializer retry, snapshot/stop/fault
lifecycle, rejected addresses and unsupported declarations. All 123 focused
struct Object, constrained interface/generic-reference/generic-value, direct
struct-call, and boxed-interface checks passed at `0895ee5c`, using Node 24,
one worker, and a 512 MB old-space limit. Validation command:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-constrained-object-tostring.test.js tests/a05-constrained-interface-calls.test.js tests/a05-constrained-generic-reference.test.js tests/a05-constrained-generic-value.test.js tests/a05-value-instance-calls.test.js tests/a05-boxed-interface-calls.test.js
```
