# Concrete constrained Int32 ToString

Direct CIL supports `constrained. System.Int32` (a concrete TypeRef) immediately
followed by the ordinary instance `System.Object.ToString(): string` MemberRef.
The receiver must be an owned, live managed address whose declared storage type
is exactly the builtin Int32 MethodTable. The runtime reads the canonical signed
Int32 value and uses the existing formatting path. It allocates the result
string, with no temporary receiver box and no write to the original storage.

Local, argument, field, static, array, existing box and nested struct interiors
reuse the existing managed-address implementation. Foreign VM addresses, expired
frames, stale heap owners, invalid paths/slots, wrong declared types and
uninitialized or noncanonical stored values keep explicit faults. Readonly
addresses remain outside this increment. TypeRef name resolution must still
produce the builtin primitive table; a user TypeDef cannot replace it here.

The receiver stays on the evaluation stack through formatting and string
allocation. Its containing heap object is also temporarily rooted for host
callbacks. Only successful allocation replaces the one input with one result.
A formatting exception or managed heap limit therefore preserves the operand
and balances temporary roots. Prefix handling remains stateless, so ordinary
pause/snapshot/restore and code-epoch invalidation need no new snapshot fields.

`ConstrainedObjectProfile.int32(typeToken, descriptor)` is the shared metadata
predicate for this leaf. It caches TypeRef classification and reuses
`declaration(descriptor)` for exact Object.ToString shape and the raw ordinary
HasThis header. Other primitives, concrete TypeSpecs, generic parameters,
GetHashCode/Equals, ExplicitThis and source compiler lowering are not added.
This implements one bounded part of #1357, whose full acceptance remains open.

The former primitive-rejection case in `a05-constrained-object-tostring.test.js`
now uses Int64 because Int32 is intentionally supported. New guest metadata
fixtures assert Int32 bounds, exactly one result allocation, storage locations,
invalid/foreign/expired addresses, allocation/host faults, collection, snapshots
and metadata replacement. Native/browser parity and performance qualification
remain pending. No tests, builds, checks or native processes were run during
implementation; the root agent owns the serial validation queue:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-constrained-int32-tostring.test.js tests/a05-constrained-object-tostring.test.js tests/a05-constrained-reference-tostring.test.js tests/a05-constrained-generic-value.test.js tests/a05-constrained-interface-calls.test.js tests/a03-08-prefix-constrained.test.js
```
