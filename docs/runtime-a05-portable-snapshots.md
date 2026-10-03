# E01 portable snapshots

The runtime exports `serializeSnapshot(vm, snapshot?, options?)`, `deserializeSnapshot(vm, payload, options?)`,
and `restoreSerializedSnapshot(vm, payload, options?)`. These asynchronous APIs use Web Crypto SHA-256 to bind
state to the exact source image or CIL assembly and rebind VM, heap, type and method identities on import.

```js
const saved = await serializeSnapshot(original, original.snapshot(), {json: true});
const resumed = new CilVirtualMachine(theSameAssemblyBytes, theSameOptions);
await restoreSerializedSnapshot(resumed, saved);
const result = resumed.run();
```

The default export is a structured-clone-safe plain graph. Set `json: true` for JSON text. Integer widths,
BigInt, undefined, negative zero, nonfinite numbers, typed-array bytes (including NaN payloads), maps, sets,
cycles, aliases, faults, generic instantiation keys and canonical code references have explicit encodings.
Schema version 4 describes VM state; portable format version 1 describes its transfer encoding.

Code, entry point, native integer ABI and irreversible host-operation revision must match. A fresh VM
cannot restore history that already performed external host operations. Functions, accessors and arbitrary
host class instances cannot be transferred. Restore retains the destination's configured host callbacks
and resource budgets. Source restores enter the existing paused debugger state; set `state = 'running'`
or call the source VM's `run()` to continue.

Imports enforce configurable positive integer `maxNodes`, `maxItems` and `maxBytes` limits (defaults:
1,000,000 nodes, 8,000,000 items, 64 MiB). Heap accounting, frames, stacks, pointer lifetimes, synchronization,
async state and generic cache keys are checked before execution state is replaced. Invalid wire data raises
`SnapshotFormatError` with a stable `code`; invalid in-memory state raises a typed validation error.

Heap captures reuse immutable copies of unchanged records. Live arrays keep contiguous writable backing;
snapshots expose read-only typed views and restore independent mutable backing. Legacy writes through a
retained heap data view are detected at capture. Mutable host payloads use the full-copy path. Frame,
scheduler and fault graphs share one copy memo to preserve aliases.

Implementation and test fixtures are staged. Product tests, native comparisons, browser runs and retention/
latency measurements remain deferred until the full E01 scope is assembled; no new qualification is claimed.
