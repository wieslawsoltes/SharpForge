# Managed heap embedding contract

The runtime package exports `ManagedHeap`, its collector services, and typed GC API helpers through `@sharpforge/runtime`.
The compatibility module `packages/runtime/src/heap.js` still exports `ManagedHeap`, `ManagedFault`, and `isReference`.
State belongs to each heap; two VMs do not share identities, handles, roots, collector phases, or counters.

## Allocation and identity

```js
import {ManagedHeap} from '@sharpforge/runtime';

const heap = new ManagedHeap({maxBytes: 16 * 1024 * 1024, generational: true});
const owner = heap.array('object', 2);
const handle = heap.createHandle(owner);
const text = heap.string('retained');
heap.writeElement(owner, 0, text);
heap.collect([], {generation: 0});
console.log(heap.get(heap.get(owner).data[0]).data);
heap.releaseHandle(handle);
heap.dispose();
```

`allocate(kind, type, data, extraRoots, options)`, `object(type, fields, options)`, `string(text, extraRoots, options)` and
`array(elementType, length, options)` return immutable `{h, g}` references. `h` indexes a slot and `g` identifies its
current occupant. `get` throws `NullReferenceException` for null and `InvalidReferenceException` for a stale identity;
`tryGet` returns null for invalid identities. Slot reuse increments its identity. A saturated slot is retired permanently.
Debugger rewind preserves identity high-water marks, so an object allocated in a discarded future cannot alias a later allocation.

Initializer references and explicit roots remain live through allocation-triggered collection. `withRoots(values, action)`
provides the same scoped guarantee to hosts and unwinds even if enumeration or the action throws. New objects published
during an incremental cycle are marked black. Their publication serial, separate from handle identity, excludes them from
that cycle's survivor promotion.

The default managed element limit is 1,000,000 and can be configured through `maxArrayLength`, up to Int32.MaxValue.
Negative or fractional lengths produce `OverflowException`; configured element and heap limits produce `OutOfMemoryException`.
The allocator performs one automatic collection decision per request, followed by at most one full compacting recovery
for a hard-limit or backing-store allocation failure. Arbitrary host exceptions retain their original type.

`createAllocationContext({threadId, budget})` creates an explicit context with a refill budget and exact byte counter.
Its `allocate` method uses the same root, lifetime, identity, and hard-limit rules as ordinary allocation. Call `dispose`
when the logical thread ends. A context never hides roots or changes the global heap limit.

## Layout and storage

`TypeDescriptors` caches immutable reference maps by method table and record kind. A map contains either no references,
all slots, or an ordered field bitmap. Primitive arrays require constant-time tracing regardless of length.
`visitEdges(record, visitor)` returns the number of examined reference-capable slots. `visitEdgeRange` accepts a cursor,
work limit, visitor, and optional reusable result object; a bitmap cursor is an ordinal in its reference map.

`recordSize` and `valueSize` account for declared managed layout, independently of actual JavaScript process memory.
The configured pointer size is 4 or 8 bytes. On the 8-byte profile the minimum object is 24 bytes, array data starts after
a 24-byte logical header, and an Int32 element occupies 4 bytes. A 10-element Int32 array therefore accounts for 64 bytes.
Strings include their length, UTF-16 data, terminator, and alignment. Field layouts use declared widths and natural alignment;
host objects without declared field layouts account for pointer-sized dynamic slots.

This is a managed accounting profile, not a measurement of the host engine's object headers or a claim of native CLR ABI
compatibility for every source-language struct layout. Diagnostics report arena capacity, host slot storage, string mirrors,
and sampled process/browser memory separately. See [spatial storage](gc-spaces.md) for movement, large objects, pins, and freezing.

## Root publication and writes

`rootVisitor(visitor)` is the preferred root provider; the older `rootProvider()` iterable remains supported.
`RootRegistry.register(category, provider, owner)` supplies explicit owner-bound root scopes. Roots also include temporary
pins, strong host handles, pinned lifetimes, and queued finalizers. Interior roots retain their owning managed identity.

Mutable host integrations use `writeField`, `writeElement`, `writeRoot`, and `writeStatic`. The methods validate identities,
perform the mutation, update old-to-young remembered cards, maintain incremental marking, notify background marking, and
advance the diagnostic mutation stamp. Direct `record.data[index]` stores bypass these publication guarantees.

`bulkCopy(destination, start, source, sourceStart, count)` supports a managed reference, array view, host array, or typed array
as its source. `fillArray(destination, start, count, value)` fills managed arrays. Both validate before publication, preserve
overlapping-copy semantics, use backing storage operations, and publish one range barrier. A primitive range needs no GC
reference scan. An old reference-containing owner dirties one owner card; active marking scans only reference-capable slots
in the overwritten range. Range notifications include `index` and `count`.

`replaceData(reference, data)` is a transactional resize for host-owned indexed records. It preserves identity, publishes
replacement references, accounts for generation/space transitions, and rejects pinned or frozen storage. Empty replacement
also advances the mutation stamp. Barrier diagnostics count logical stores and incoming managed references.

## Collection

`collect(extraRoots, {generation, reason, blocking, compacting})` defaults to a blocking generation-2 collection.
Generations are 0 through 2. Automatic generational collection is enabled with `generational: true`; `incremental: true`
requests cooperative automatic slices. Explicit generation requests work independently of automatic policy.
Survivors age through generation 1 to generation 2. Large, pinned, and frozen spaces start outside the nursery.

`startIncremental(options)` starts a cycle; `step(workBudget)` advances charged object/edge work and returns the phase and
whether the cycle completed. Safepoint coordination surrounds collection work, including direct collector calls and
allocation-triggered requests. Termination rescans roots and finishes weak/finalizer processing before reclamation. Root
and object insertion barriers remain active through sweep and promotion.

Full-generation marking can consume a single reference slot directly from current canonical slot storage. It charges
one object start and one edge, including when the reference bitmap selects a nonzero field. One-unit slices, resumed
cursors, remembered owners, and host replacement or accessor payloads retain the general visitor. The direct path calls
the same child-marking hook, so dependent-handle activation and block liveness accounting retain their usual behavior.

The work budget bounds charged tracing, sweep, and promotion operations. Atomic root termination, lifetime closure, and
explicit compaction are measured separately; the budget is not a hard wall-clock pause guarantee. Browser Worker marking
has additional capability requirements documented in [spatial storage](gc-spaces.md).

`stats.generationCounts` and `stats.generationBytes` describe currently live objects. `generationCollections` is cumulative.
Numeric allocation counters preserve the existing JSON-facing shape. `allocatedBytes64` is the exact BigInt counter;
the same property on `stats` is non-enumerable so existing numeric JSON reports remain serializable.

## Verification, snapshots, and disposal

`verify({maxObjects, maxEdges, throwOnError})` checks identities, free slots, layout, live accounting, roots, edges,
remembered cards, and active marking invariants. The default is to throw `HeapVerificationError` with a structured report.
With `throwOnError: false`, callers receive the report directly. Exhausting a verification budget is an explicit incomplete result.

`snapshot` and `restore` coordinate the heap's services and spatial views. Snapshots are versioned and retain owner identity;
restoring an incompatible heap or an irreversible external-resource transition fails explicitly. They support in-session
debugger rewind, not portable JSON persistence. [Heap dumps](gc-diagnostics.md) are the portable read-only graph format.

`dispose` is idempotent. It applies the lifetime shutdown policy, cancels collector/background work, reclaims all storage
including frozen objects, releases event/counter subscriptions, and closes allocation contexts. Subsequent allocation or
collection fails with `ObjectDisposedException`. `vm.stop()` has its own runtime teardown and follows the .NET Core policy
of discarding pending managed finalizers at shutdown. Explicit finalizer drains remain available while the VM is running.

## Related contracts and validation

- [Lifetime services and host handles](gc-lifetime.md)
- [Spatial storage and Worker capability limits](gc-spaces.md)
- [Diagnostics, dumps, and benchmark methodology](gc-diagnostics.md)
- [Root publication contract](../planning/contracts/gc-roots.md)
- [Write barrier contract](../planning/contracts/gc-barriers.md)

Focused tests are assigned to the A06 test manifest. Validation results and issue-level qualification are recorded after
the complete integrated scope is exercised; the presence of an implementation or fixture alone is not a platform pass.
