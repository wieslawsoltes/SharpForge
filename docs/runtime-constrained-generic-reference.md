# Generic parameter constraints on reference calls

Direct CIL accepts `constrained.` TypeSpec operands that consist of one declared
type parameter (`!0`, etc.) or method parameter (`!!0`, etc.). The current closed
frame supplies that parameter through the existing generic-call substitution
service. Its resulting type must still be a nongeneric internal reference class;
the existing class/interface call path validates the owned address and exact
declared storage type, then performs ordinary virtual dispatch.

Cold verification reuses the existing `validateTypePrefixes` lexical verifier,
including token row extents, duplicate-prefix rejection and instruction-group
boundaries. It then uses existing generic signature verification to check the
parameter ordinal against the declaring type or method metadata. Each method
containing constrained calls has one additional bounded lexical decode during
verification. No per-instruction decoder or new metadata cache is introduced.

Existing GenericParam/GenericParamConstraint and MethodSpec validation remains
responsible for closed-call admission. A missing runtime context faults before
receiver dispatch. An edited context resolving to a different class cannot
reinterpret an address with another declared storage type. Unsubstituted metadata
names stay in the token cache; substitution uses each live frame, preventing
cross-instantiation cache reuse. Snapshots retain the existing closed method
context and require no new schema fields.

This extends the [reference constraint leaf](runtime-constrained-reference-calls.md)
without admitting generic value receivers, closed generic receiver classes,
generic member declarations or interface-typed constraints. The separate
[base-bound Object.ToString leaf](runtime-constrained-generic-tostring.md) admits
that one Object member with a concrete internal base bound. Other Object members,
DIM and source frontend lowering remain pending parts of #1357.

Prepared guest-CIL fixtures cover both parameter kinds, class/interface dispatch
through multiple instantiations, GenericParam constraints, exact byref storage,
malformed/missing context, unsupported closed types, null, GC, snapshot replay and
stop cleanup. All 73 tests below passed at `e5de76cc`, using Node 24, one test
worker and a 512 MB old-space limit. Native and performance qualification remain
deferred. The root-owned serial queue ran:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-constrained-generic-reference.test.js tests/a05-constrained-reference-calls.test.js tests/a05-constrained-interface-calls.test.js tests/a05-02-generic-calls.test.js tests/a03-08-prefix-constrained.test.js
```
