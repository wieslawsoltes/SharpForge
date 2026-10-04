# Managed lifetime, finalization and pinning

The A06 lifetime service belongs to one `ManagedHeap`. Its roots and identities are
independent of JavaScript `WeakRef`, JavaScript `FinalizationRegistry`, native process
addresses, and the host garbage collector's timing. Source and direct CIL runtimes
use the same service through their registered framework contracts.

This implementation covers SF-A06-T02.1–T02.5, T03.1–T03.4, and T05.1–T05.3.
The regression files are `tests/a06-lifetime-*.test.js`. Engine and platform
qualification results belong in the integration PR; the existence of these fixtures
does not establish a CoreCLR, browser, Rust, or native-platform pass.

## Heap integration

`LifetimeManager` is constructed once with the heap. Allocation calls
`lifetime.allocated(reference, record)` after the record is published. The runtime's
`finalizerResolver(reference, record)` returns either `null` or a callback/managed
method descriptor, optionally wrapped as `{callback, critical}`. A descriptor's
`finalizer` property provides the corresponding heap-only registration mechanism.

Every managed reference remains an immutable `{h, g}` identity. `g` is the identity
generation for a slot, not its collection generation. Pinning, weak references,
dependent handles, finalizers, and interior references validate the entire identity.
A recycled slot cannot acquire the lifetime state of its former occupant.

The collector calls these service hooks:

| Hook | Responsibility |
| --- | --- |
| `beginMark()` | Reset dependent activation state for one collection. |
| `noteMarked(reference)` | Activate dependent handles indexed by a newly marked primary or table owner. |
| `visitStrongRoots(visitor)` | Visit strong host handles, counted pins, queued finalizers, and an active finalizer's execution roots. |
| `finishMark({isMarked, mark, drain})` | Complete ephemeron, weak-reference, and finalization phases. |
| `onReclaim(reference)` | Retire managed-owner handles, conditional tables, finalizer metadata, and virtual addresses. |

For minor collections, `isMarked` reports non-condemned generations as live.
The lifetime phases therefore cannot clear a weak reference to an uncollected old
object or finalize an uncollected old object. New dependent values installed during
an incremental collection pass through `collector.dependentBarrier`; this also
protects updates performed after the initial marking phase has completed.

## Reachability phases

The order is deliberate:

1. Trace ordinary roots and ordinary strong edges.
2. Complete dependent-handle reachability from already reachable keys.
3. Clear unreachable `WeakShort` targets.
4. Discover all unreachable registered finalizable objects before tracing any one
   candidate. Queue every candidate and trace the complete f-reachable graph.
5. Complete dependent-handle reachability again, including newly f-reachable keys.
6. Clear unreachable `WeakLong` targets and unreachable dependent associations.
7. Sweep unmarked condemned objects. No user finalizer executes during collection.

Discovering all candidates before marking their graphs ensures that a normal
finalizer referencing a critical finalizable object does not hide that critical
object from the same discovery cycle. The drain always chooses normal queued
finalizers before critical queued finalizers.

Dependent handles are ephemerons: a reachable primary retains the secondary; a
secondary's reference back to the primary does not establish primary reachability.
A managed `ConditionalWeakTable` additionally requires its table owner to be live.
Each dependent handle is processed once after its activation conditions become
true. The collector's notifications and a per-primary index avoid a full table
rescan for every link in a long dependent chain. Work is proportional to handles,
activations, and the traced graph, rather than the square of the chain length.

## Host handles and managed GCHandle

The existing host API remains valid:

```js
const root = heap.createHandle(reference);
const weak = heap.createHandle(reference, {weak: true});
heap.getHandle(root);
heap.releaseHandle(root);
```

Host release is idempotent. A foreign heap cannot read or release the handle. The
opaque handle's `owner` is the heap identity; the optional creation option `owner`
is an independent diagnostic/teardown tag and cannot change that identity.
The optional `category` uses `RootCategory` values, defaults to `Handle`, and
preserves a debugger or interop root's classification in retention diagnostics
and snapshots independently of its teardown tag. Unknown categories are rejected
before a handle or pin lease is published.

Typed handles support `Strong`, `WeakShort`, `WeakLong`, `Pinned`, and `Dependent`.
`{weak: true, trackResurrection: true}` selects a long weak handle. The legacy
`{weak: true}` overload still requires a managed reference; the explicit weak kinds
also accept `null`, as required for a managed weak-reference target.

```js
const handle = heap.lifetime.createHandle(reference, {
  owner: 'studio-session:42',
  kind: HostHandleKind.Strong,
  captureStack: true
});

const leaks = heap.lifetime.leakReport();
const released = heap.lifetime.releaseOwner('studio-session:42');
```

Debug mode (`debugHandles: true`) records creation stacks. Reports include owner
tags and handle kinds; owner teardown releases only that owner's handles, pins,
and registered native resources. Native release failures are collected after all
matching resources have been attempted.

`ManagedGCHandle.alloc(heap, target, type)` provides the four numeric .NET kinds:

| GCHandleType | Numeric value | Retention |
| --- | ---: | --- |
| `Weak` | 0 | Short weak reference. |
| `WeakTrackResurrection` | 1 | Long weak reference. |
| `Normal` | 2 | Strong root. |
| `Pinned` | 3 | Strong root and counted movement exclusion. |

Its `target` property is writable. `isAllocated`, `free()`, `toIntPtr()`,
`ManagedGCHandle.fromIntPtr(heap, token)`, and `addrOfPinnedObject()` implement the
managed operations. Double free, access after free, and foreign token imports
produce `InvalidOperationException`. Managed handles require explicit `Free`;
collecting the managed value wrapper does not silently free a leaked normal handle.

An IntPtr handle token is an opaque owner-scoped object with an exact BigInt `value`.
Repeated conversions of one live handle produce the same token. Extracting its
numeric value for display does not transfer the authority to import the handle into
another heap. Bare numbers/BigInts are not accepted as handle capabilities.

## Weak references and conditional tables

`ManagedWeakReference` supports `target`, `isAlive`, `trackResurrection`,
`tryGetTarget()`, `setTarget(value)`, and explicit host-wrapper disposal. A short weak
reference clears in the first collection that discovers its target for finalization.
A long weak reference survives while the target is f-reachable and clears during a
subsequent collection if the finalized target has not been resurrected.

Managed WeakReference wrappers store an opaque weak-handle token, never a strong
target field. Reclaiming their managed wrapper retires the associated weak handle.
`ManagedConditionalWeakTable` provides `add`, `remove`, `clear`, `tryGetValue`, and
`getValue(key, factory)` with duplicate/null-key validation and reentrant factory
handling. Host wrappers are explicitly disposable. Managed wrappers retire their
dependent handles when the table itself is reclaimed.

The framework adapter implements both actual CIL byref arguments and the source
engine's local-cell and declared owner/index array-cell ABI for `TryGetTarget`, `TryGetValue`, and
`DangerousAddRef`. Distinct internal source bridge contracts keep those two calling
conventions explicit. Managed table value factories run through the runtime's
bounded callback executor.

Array-element cells retain their owner as a precise field and resolve its current
storage on each access. Framework out writes also follow that owner/index path,
including a cell forwarded through another source method. The declared layout,
compaction behavior, and pending fixtures are described in [managed array references](gc-byref-arrays.md).

Native CIL `ConditionalWeakTable<TKey, TValue>.CreateValueCallback` signatures use
an inner `TypeRef` whose resolution scope is the enclosing table's `TypeRef`, with
both enclosing generic arguments supplied by the callback's `TypeSpec`. The four
registered `object`/`string` key and value pairs keep their existing framework
display names and contract IDs. Native `Outer+CreateValueCallback<TKey, TValue>`
spellings resolve to those same contracts. `GetValue` rejects a null callback before
consulting a cached entry. Hand-authored CIL coverage is in
`tests/a06-api-cwt-native.test.js`; it does not use the source compiler or a `#SF`
execution profile.

## Finalizer execution and resurrection

Registered finalizable objects do not constitute strong roots. Queued and running
finalizers do. A finalizable object therefore survives its discovery collection,
its complete object graph remains usable during finalization, and it becomes
eligible for reclamation in a later collection after finalization completes.

```js
heap.lifetime.registerFinalizer(reference, (target, {heap}) => {
  // A host integration callback; it must perform bounded synchronous work.
  releaseAssociatedNativeResource(target, heap);
});

heap.collect();
const result = heap.lifetime.drainFinalizers({budget: 128});
```

`suppressFinalize(reference)` cancels pending registration/queued execution.
`reRegisterForFinalize(reference)` restores registration; if called while that
object's finalizer runs, it schedules eligibility for a later collection. Publishing
the object into a strong managed root during finalization resurrects that same
identity. Re-registration is independent of resurrection: each operation has its
own effect.

The finalizer context is cooperative. A managed executor returns a runner with
`step(instructionBudget) -> {done, instructions}`. The default slice is 128
instructions and the default per-finalizer limit is 100,000 instructions; both are
explicitly configurable. A generator host callback can yield bounded work units.
Ordinary host callback return values are discarded at the void callback boundary,
so an expression body such as `log.push(value)` completes normally. Returning a
generator or runner opts into cooperative scheduling; host Promises are rejected.
Trusted plain JavaScript callbacks must be bounded by their host implementation;
JavaScript cannot preempt an arbitrary synchronous callback.

Unhandled finalizer exceptions and exhausted instruction budgets fault the
finalizer context. Runtime integration treats these as fatal VM faults and does not
continue running later finalizers. `WaitForPendingFinalizers` cooperatively parks
the managed caller until draining completes; a call from the finalizer context
itself returns without waiting on its own execution. Heap-only host waiting has an
explicit aggregate instruction bound.

## Critical finalizers and SafeHandle

`ManagedSafeHandle` registers a critical finalizer for an optional managed owner.
It supports balanced `dangerousAddRef()` / `dangerousRelease()`, `close()` /
`dispose()`, `isClosed`, `isInvalid`, `dangerousGetHandle()`, and
`setHandleAsInvalid()`. Closing prevents further borrows immediately. Physical
release waits for outstanding borrows and invokes the native release hook exactly
once. Invalid and unowned handles skip native release.

Native buffers automatically contribute their exact declared buffer/view byte
length to memory pressure while owned. Other native resources can specify
`memoryPressureBytes`; an unknown native size contributes zero rather than an
invented estimate. Pressure remains charged while a closed handle has outstanding
borrows and is removed exactly once on physical release or teardown. Pin acquire
and release events carry action, lease identity, and the current pin count.
Finalizer begin/end events bracket actual cooperative work, including faulted
slices; an empty drain emits no finalizer-work events.

The managed SafeHandle bridge keeps base state in a heap-owned side table. It does
not append fields to a derived object's declared layout. The runtime dispatches
`get_IsInvalid` and `ReleaseHandle` to the most-derived managed implementation.
An existing derived `Finalize` override remains registered and critical; completing
that finalizer also completes the bound SafeHandle release path.

Source SafeHandle base construction and access to its protected `handle` member use
explicit internal initialization/get/set contracts. Foreign CIL retains its native
base-constructor and managed-address calling conventions.
The independently authored CIL fixtures exercise that constructor on a derived
receiver, native-word handle round trips, critical release, and a real `bool&`
argument to `DangerousAddRef`, without using the source compiler or its bridges.

## Pinning, addresses, and interior references

`heap.lifetime.pin(reference, {owner, reason})` returns a frozen disposable lease
with `reference` and `address`. Every lease is a strong root, increments the record's
`pinCount`, and excludes that object's backing storage from compaction. Multiple
simultaneous pins of the same identity share one address. Releasing one lease does
not invalidate the address until the final lease is released.

An array allocated in the pinned object heap remains pinned for its entire managed
lifetime. Its address is created lazily and remains identical across temporary
lease disposal and reacquisition. The address table does not root that array;
collection invalidates its token when the array becomes unreachable. Temporary
fixed-scope pointer wrappers still require their own live lease before access.

```js
const pin = heap.lifetime.pin(array, {owner: 'interop', reason: 'native-call'});
try {
  const address = pin.address.add(4);
  const {reference, record, byteOffset} = heap.lifetime.addresses.resolve(address);
  // Consume the explicit logical identity and offset through an approved adapter.
} finally {
  pin.dispose();
}
```

Addresses are `ManagedAddress` capabilities, not JavaScript pointers. The virtual
range allocator advances monotonically and never reuses a range within a session.
For an ordinarily movable object, the last unpin invalidates the entire range,
including previously derived offsets. A lifetime-pinned POH range is invalidated
when its object is reclaimed.
Stale, foreign, out-of-range, and unpinned reads raise `InvalidAddressException`.
Inactive range metadata is periodically compacted without reusing its numeric
addresses. Virtual-range exhaustion is an explicit `OutOfMemoryException`.

An interior reference is an owner plus an immutable inline slot path:

```js
const byref = createInteriorReference(heap, array, [index]);
const lease = heap.createHandle(byref);
heap.collect([], {compacting: true});
resolveInteriorReference(heap, byref, {write: true, value: 42});
heap.releaseHandle(lease);
```

The byref roots its owner without pinning it. Resolution reads the owner's current
backing storage after relocation. It validates owner generation, path depth,
bounds, readonly state, and frozen storage. A path cannot cross an object-reference
boundary; a byref into another object must identify that object as its own owner.
Writes use the heap's mutation barrier.

## Snapshot and shutdown policy

Lifetime snapshots include typed handles, weak/dependent registrations, conditional
table entries, finalizer queues, pin leases, virtual address ranges, and SafeHandle
state. Active managed runners provide `snapshot()` and `restore(state)` for their
execution state. An active host generator without that contract is explicitly
unsnapshotable. Opaque owner tokens and captured lease identities are retained.

Restore does not rewind handle, pin, table, or address allocation high-water marks.
Capabilities from a discarded future branch cannot alias a later allocation.
Captured capabilities may become valid again when restoring the snapshot that
owned them. Native resource acquisition/release advances an irreversible revision;
restore across that revision is rejected before changing managed records. Host
callback closures remain host-owned; arbitrary external effects are not cloned by
a managed snapshot.

Shutdown follows the .NET Core policy: queued managed finalizers are discarded.
Managed SafeHandle `ReleaseHandle` overrides are also not invoked at process exit.
Actual host-native resources registered with release hooks are disposed
deterministically, all host handles and pin leases are released, and release errors
are reported after the remaining resources have been attempted. Repeated shutdown
returns the same report. Finalizer execution stays stopped after shutdown.

VM shutdown also releases its frozen literal, scalar-array and static-data stores
after clearing execution roots and lifetime leases. Those records deliberately
survive ordinary collections, so shutdown reclaims them explicitly through the
same accounting and handle invalidation path used by the collector. A later
explicit collection on the stopped heap remains supported.
