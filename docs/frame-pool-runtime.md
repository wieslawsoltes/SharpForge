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

Prepared primitive source calls and eligible closed CIL virtual calls carry an
opaque storage capability for the exact code metadata and storage shape. CIL
bindings also validate the live signature, parameter count and stack capacity.
Each current VM pool privately binds it to that pool's existing size bucket once.
Shared metadata never shares frames,
free lists or managed roots between VMs. Replaced metadata and discarded pools
reject the old binding; a new pool may bind the same unchanged metadata afresh.
The capability contains no VM, pool, bucket, frame or managed value, and neither
capabilities nor bindings are serialized. Prepared CIL entry still performs the
ordinary stack admission, argument storage conversions, fresh frame-ID issuance,
registration and method events. Custom `vm.call` hooks keep the ordinary call
path, and custom storage hooks continue to normalize arguments with caller roots
held live until admission completes.

Changing a method's local capacity invalidates its old size bucket. Already-clean
cached frames are dropped with matching retention counters; still-active frames
from that bucket are scrubbed at retirement but cannot be cached into it again.
Both source and CIL prepared bindings rebind when their prior bucket is invalid.

Prepared retirement clears present enumerable own fixed fields with explicit
stores and retains the ordinary cleanup for additional runtime and
host metadata, including return, delegate, exception and pin bookkeeping. Deleted
or nonenumerable factory fields and inherited getters keep ordinary behavior. It
allocates no `Object.keys` array. All five owned arrays retain their identities
and have length zero after the flush. Retirement still revokes frame-owned
capabilities immediately; deferred roots survive until the enclosing instruction
flush. Ordinary acquisition uses the same bucket allocation, byte accounting and
statistics. `tests/a05-source-prepared-frame-pool.test.js` exercises forged and
stale authority, shared metadata, late fields, temporary roots, pin release,
array identities and retention budgets. All seven new cases and the combined
122-test pool/fusion/index run passed at `48c62243`. The unchanged Fibonacci
measurements remain inconclusive against 1.5×; see the
[retained 20- and 100-pair evidence](https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/source-fibonacci-2026-10-04/README.md).

The corresponding CIL pool suite adds
signature/stack-capacity checks, changed-local rebinding with delayed retirement,
and ordinary/prepared setter-order parity. The CIL extension awaits its serial
test and unchanged paired performance runs; no speedup is claimed for it.

This is the storage-reuse increment of #1399. Focused tests exercise warmed calls,
recursion, EH, snapshots, stale addresses, budgets and parked cancellation. Allocation,
retention and latency benchmarks, typed stacks, complete debugger/native/Wasm and
cross-platform qualification remain staged for the integrated epic. No speedup or
process-memory reduction is claimed without those measurements.
