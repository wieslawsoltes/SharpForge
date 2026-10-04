# Managed frame storage reuse

Source, source reloaded from emitted CLI, and direct CIL calls reuse frame objects
and their argument, local and evaluation-stack arrays. Source evaluation still
uses the VM's shared stack. CIL call arguments are copied into owned frame storage;
managed call scratch buffers also serve synchronous intrinsics and delegates.
They never escape into retained frame or scheduler state. Platform contracts keep
owned arrays for host operations that may outlive the call; see
[CIL call argument buffers](call-argument-buffers.md).
Every entry receives a fresh monotonic frame ID, so an address to a returned local
cannot access a later invocation that reuses its storage.

`framePoolBytes` defaults to 1 MiB; it is a nonnegative safe integer logical storage
budget (128 bytes per frame plus eight per reserved argument/local/stack slot).
This accounting is not a JavaScript heap or RSS measurement. `framePooling: false`
disables retention. Both modes keep the existing frame-depth and stack limits.
Pools are scoped to a VM and its code owner (including the CIL code epoch). Successful snapshot restore and stop
drop derived pools; a rejected restore preserves them. Snapshots contain execution
state, never pools. Parked scheduler contexts remain live; returned, unwound and
explicitly canceled contexts clear references at safe instruction boundaries.
Fatal active stacks remain inspectable until disposal.

`framePoolStatistics(vm)` returns a frozen snapshot with `framesAllocated`,
`arraysAllocated`, `reused`, `released`, `cachedFrames` and `retainedBytes`. Array
counts cover allocations owned by this pool, not every runtime or engine allocation.
Method lookup and free-list operations are constant time; clearing a retired frame
is linear in its fields, and context disposal is linear in its frames.

This is the storage-reuse increment of #1399. Focused tests exercise warmed calls,
recursion, EH, snapshots, stale addresses, budgets and parked cancellation. Allocation,
retention and latency benchmarks, typed stacks, complete debugger/native/Wasm and
cross-platform qualification remain staged for the integrated epic. No speedup or
process-memory reduction is claimed without those measurements.
