# Constrained calls on nongeneric structs

The direct CIL engine accepts `constrained. <TypeDef>; callvirt <interface method>`
for an owned managed address of a reference-free sequential user struct. Existing
interface tables select implicit and explicit implementations. The selected body
must belong to the exact struct type and be in the verified reachable-method set.
It receives the original address, so mutations reach locals, array elements,
nested fields, or an existing box interior without allocating a new box.

The prefix remains a separate debugger-visible instruction. Its adjacent call
derives the constraint from the immutable method body and existing program
counter; there is no pending-prefix field to serialize or clear on exceptions.
Verification prohibits branches, switches, or exception boundaries entering the
call after its prefix. Existing `volatile.` admission and boundary checks remain.
Type-initializer retries retain the same call position and unconsumed arguments.
Ordinary frame/byref roots and same-VM snapshots apply without a schema change.

This is a bounded increment of #1357. Nongeneric reference receivers are covered
by the [separate reference-call leaf](runtime-constrained-reference-calls.md).
Object/ValueType fallback boxing, enum/primitive receivers, generic constraints and interfaces,
default-interface bodies, readonly/ref-like structs, and source frontend lowering
remain unsupported. Full #1357 acceptance remains open. This change does not add
a native or portable snapshot claim, or a performance result.

All 85 focused tests passed at `4ecb7ac6`, including integration with the newly
merged CIL constrained/tail prefix verifier. Regression coverage includes implicit/explicit dispatch without receiver
allocation, copy isolation, interior mutation through GC, prefix/callee snapshots,
static initialization retry, stop/fault cleanup, invalid addresses, and malformed
prefix flow. Required PR checks follow the completed serial local validation.
The core runtime regression command is:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-constrained-interface-calls.test.js tests/a05-boxed-interface-calls.test.js tests/a05-value-instance-calls.test.js tests/a05-statics.test.js tests/a05-02-interface-dispatch.test.js
```

The supported rule follows the
[CLR constrained opcode contract](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.opcodes.constrained?view=net-10.0):
when a value type supplies the implementation, that body receives the original
managed address. The broader rules are specified by
[ECMA-335, III.2.1 constrained.](https://ecma-international.org/publications-and-standards/standards/ecma-335/).
Native differential and cross-platform qualification remain deferred.
