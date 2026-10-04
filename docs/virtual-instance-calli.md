# Virtual instance function pointers

Direct CIL now admits `ldvirtftn` for default managed, nongeneric virtual methods
on internal reference classes whose class ancestry ends at `System.Object`.
The instruction consumes a live owned receiver, selects its virtual body through
the existing slot resolver and polymorphic inline cache, and produces the same
opaque pointer used by [managed instance calli](managed-instance-calli.md).
The selected body is captured once. A subsequent `calli` invokes that body
directly with its own explicit receiver; it never repeats virtual selection.
For example, capturing `Base.Get` on a Base object and later passing a Derived
object to calli still executes Base.Get, even if Derived overrides it.

The existing declaration slots preserve inherited overrides, newslot hiding,
final restrictions and exact-signature class MethodImpl mappings. Abstract
virtual declarations are allowed when concrete descendant implementations exist.
Verification visits every eligible selected executable body, including overrides
whose classes the program does not allocate. It does not enqueue an abstract
declaration as executable IL. Runtime rechecks selected-body membership in the
verified report before producing a pointer.

Null, foreign, copied, stale or incompatible receivers fail before the original
operand is removed. The declaration owner's receiver check runs before virtual
selection, and the selected body uses the ordinary instance-calli eligibility
check. This includes warm inline-cache hits. The pointer holds only a method
token and VM identity, so it does not retain the capture object. Normal pooled
calls, argument roots, initialization and fault handling remain unchanged.
Snapshots retain frozen pointer/receiver identity; restore and metadata
replacement invalidate the derived caches. No new snapshot field is required.

`VirtualPointerProfile(inspector, dispatch?)` is the shared public metadata
adapter. `reachable(methodDefToken)` returns a frozen array of selected body
tokens; `contains(declaration, target)` performs cached set membership, and
`acceptsClass(typeDefToken)` checks the supported class ancestry. The optional
dispatch argument reuses an existing `CilDispatchTable`. `InstanceCalliTargets`
adds `acceptsDeclaration(token)` for virtual declarations, including abstract
ones; its existing `accepts(token)` continues to require an executable body.
Recreate these adapters when metadata changes. Runtime owns its adapter through
the existing VM code epoch; caches contain metadata only, never managed handles.

The parent/child index is linear in metadata size. Per-declaration traversal is
limited to eligible descendants and cached after its first query. Both class and
dispatch ancestry have a depth limit of 64. A cumulative 262,144-unit budget
charges indexed rows/edges, descendant visits and a conservative square of each
inherited slot-table size, plus MethodImpl matching work, before calling the
shared resolver. It bounds cold reachability and rejects excessive metadata
with an explicit diagnostic; it is not a performance measurement. Warm target
membership and class eligibility are constant-time cache lookups.

This #1359 increment excludes nonvirtual declarations, interface/DIM targets,
value types, generic methods/classes/dispatch hierarchies, external class bases,
ExplicitThis, typed instance-pointer storage, unmanaged signatures, tail/jmp
and source compiler lowering. Nongeneric interface metadata already present on
an admitted class continues through the existing slot resolver; this does not
admit interface ldvirtftn. Static and delegate ldftn behavior is unchanged.
Portable snapshots and native/browser/performance qualification remain open.

Focused guest metadata tests cover both ABI widths with and without the PIC,
exact capture semantics, abstract/inherited/newslot/final/MethodImpl selection,
reachability, ownership and stale handles, GC, snapshot replay, metadata
replacement, verification membership, rejected profiles and the cold-work cap.
Tests, builds, checks and native runs were not executed during implementation.
The root agent owns the serial validation queue:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-virtual-instance-calli.test.js tests/a05-managed-instance-calli.test.js tests/a05-managed-calli.test.js tests/a05-delegate-targets.test.js tests/a05-inline-cache.test.js tests/a05-seams-snapshot.test.js
```
