# Constrained calls through reference storage

Direct CIL now accepts a nongeneric internal class `TypeDef` constraint for
existing internal nongeneric class/interface instance methods. The receiver must
be an owned managed address whose declared storage type exactly matches the
constraint. Its current value may be null or a live compatible reference,
including a derived instance in a base-typed slot. Null retains the ordinary
`callvirt` managed `NullReferenceException` behavior.

The normal call initialization gate runs before dereferencing and consuming
arguments. Retrying that gate leaves the address and prefix position unchanged.
The dereferenced reference is pinned with the ordinary call arguments before
existing virtual/interface cache lookup, target verification, owner selection,
and frame creation. No reference slot is overwritten, receiver copied, or box
allocated. Reference storage is read only; this does not add `readonly.` prefix
or readonly-struct support.

This follows the reference-type rule in the official
[CLR constrained opcode contract](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.opcodes.constrained?view=net-10.0).
The existing [struct interface path](runtime-constrained-interface-calls.md)
continues to pass the original value address directly. Both paths derive prefix
state from the verified instruction pair, with no new frame or snapshot fields.

This is a partial increment of #1357. External Object members, generic constraint
types/members/receivers, default-interface bodies, Object/value boxing fallback,
and source frontend lowering remain unsupported. Full native, browser and other
platform qualification remains pending; no performance improvement is claimed.

All 85 focused tests passed at `8956478d`. Coverage includes class overrides, implicit/explicit interface mapping, warm
receiver checks, array/field slots, host callback GC, prefix/active snapshots,
stop cleanup, null/uninitialized/expired/foreign addresses and unsupported Object
members. The previous struct-prefix test now rejects an interface constraint in
place of a class constraint, because this leaf adds the latter deliberately.
Required PR checks follow the completed serial local validation. The runtime
regression command is:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-constrained-reference-calls.test.js tests/a05-constrained-interface-calls.test.js tests/a05-boxed-interface-calls.test.js tests/a05-02-interface-dispatch.test.js tests/a05-inline-cache.test.js
```
