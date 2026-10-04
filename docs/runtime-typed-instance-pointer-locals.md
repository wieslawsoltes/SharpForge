# Typed managed instance-pointer locals

Direct CIL can store an opaque instance `ldftn` pointer in a directly declared
function-pointer local and invoke it with the existing managed HasThis `calli`
path. Its receiver remains an explicit call operand; the pointer retains only
the selected method token and VM ownership. Static typed-pointer paths and
native-int local storage keep their existing behavior.

The verifier reads the local's lossless signature AST. A static and instance
pointer can still have identical inspection text, but their HasThis-aware
provenance keys differ. Compatible instance targets can join through ordinary
local assignments. Missing provenance, a static target in an instance local,
or an instance target in a static local fails verification. Guest `ldloca` of
these new typed locals is rejected, so indirect stores cannot evade that proof.

The shared CIL classifier `instancePointerLocalSignature(metadata, decodedType)`
returns a frozen ordinary signature for an admitted direct HasThis pointer,
`null` for other top-level types, or a structured unsupported error. It admits
default managed, nongeneric signatures with closed ordinary primitive/named,
array or byref types. TypedReference, generic shapes, modifiers, pinning, raw
pointers, nested function pointers, ExplicitThis and other conventions remain
unsupported in the newly admitted local shape. The existing execution gate
continues to reject typed instance-pointer parameters, results and fields.

Runtime local loads and owned-address writes use metadata-only plans scoped to
the current code epoch. Every non-null value must still be an opaque same-VM
pointer to a verified, eligible nongeneric internal reference-class method,
with the exact declared instance signature. Checks precede destination writes
and write notifications. Debugger-style writes through a canonical owned local
address retain frame lifetime, readonly, owner and revision checks. Null remains
a valid default stored value and cannot be called.

The existing pooled call, receiver validation, GC roots, stack-byte quotas and
in-memory snapshot paths are reused. Frozen pointer identity survives snapshots;
restore and code replacement invalidate derived local plans. No display types,
compiler lowering, carriers, snapshot fields or quota schema change. This is a
bounded storage increment under #1359; broader pointer slots and cross-platform
qualification remain pending. There are no performance claims.

Authored guest fixtures cover both ABI widths, ordinary and typed numeric frame
storage, joins, exact static/instance distinction, foreign/copied/invalid
pointers, owned host edits, write notifications, null/uninitialized values,
snapshot/stop, metadata replacement, quota boundaries and rejected local shapes.
The earlier blanket local-rejection assertions were updated to this deliberate
admission; parameter/result/field rejection remains asserted. Tests, builds,
checks and native runs were not executed. Root owns the serial validation queue:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-instance-pointer-locals.test.js tests/a05-lossless-signature-slots.test.js tests/a05-managed-instance-calli.test.js tests/a05-managed-calli.test.js tests/a05-calli-stack-byte-budget.test.js tests/a05-seams-snapshot.test.js
```
