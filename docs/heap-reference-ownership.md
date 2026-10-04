# Allocation identity for strict receiver boundaries

ManagedHeap allocation still returns the frozen `{h, g}` handle. An internal
`WeakMap<heap, WeakSet<reference>>` now records which exact handles that heap
issued. A retained handle does not retain its heap, and the weak set does not
root a managed object or retain discarded JavaScript handle objects.

`ownsHeapReference(heap, reference)` is allocation provenance, not a liveness
check. A caller must also use the existing generation-checked heap lookup.
`heap.get`, GC, host instrumentation, handle shapes and snapshot schemas retain
their existing behavior. Copied coordinate pairs are not allocation identities.
The subsequent managed instance-calli leaf consumes this strict check; this
prerequisite does not change existing call or delegate admission.

Guest newobj, strings, arrays, boxes and platform object creation all funnel
through ManagedHeap.allocate. Runtime loads, stores and casts preserve their
reference identity. Ordinary in-memory execution snapshots retain frozen
handles; heap snapshot/restore copies record data containers while retaining
their handle elements. Failed snapshot preflight never replaces these handles.
Restoring an older snapshot does not bless an abandoned generation as live.

Existing coordinate reconstruction in UI animation/design/event bridges and
debugger watchpoint/edit-plan lookups remains coordinate-based. Those lookups
are unchanged and do not issue allocation identities. The proposed instance
calli receiver scope is internal managed reference classes, not reconstructed
framework/UI objects. There is no portable serialization or cross-VM transfer
claim; a future portable restore must explicitly recreate ownership.

Four focused tests were authored for equal-coordinate foreign/copied handles,
GC and handle reuse, heap rollback, and real CIL frame/static/array/stack aliases
across snapshot replay. No tests or builds were executed during implementation.
The root-owned serial queue can run:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-heap-reference-ownership.test.js tests/a05-seams-snapshot.test.js
```
