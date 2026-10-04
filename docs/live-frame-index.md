# Managed frame identities

`SF-A05-T03.1` replaces the managed-address scan of `allFrames()` with a private
VM-owned index. A lookup performs one map lookup and constant-time checks of the
frame ID, owning array slot and live execution-context ownership. It never
enumerates the active stack or scheduler contexts. The index is derived execution
metadata and is absent from snapshots and the managed heap root provider.

## Lifecycle contract

| Boundary | Frame identity and storage |
| --- | --- |
| Ordinary source or CIL call | Fully construct storage, append and register atomically. |
| Failed frame admission | Remove the provisional entry, release stack-byte accounting and retire storage. |
| Failed context enqueue | Dispose all admitted provisional frames and restore the parent's exact arrays and state. |
| Context activation or parking | Retain IDs and bind the same arrays to their logical context. |
| Return or exceptional unwind | Remove the ID before deferred pool clearing. |
| Context completion | Retire terminal frames before storage can be replaced by another context. |
| Cancellation | Retire parked contexts; retain the current active fault stack for inspection until stop or restore. |
| Stop | Clear the index and every live/parked frame's derived storage. Repeated stop is harmless. |
| Accepted complete VM restore | Rebuild once from the restored active and parked frame graph. |
| Rejected restore | Leave the live index, stack storage and pool unchanged. |

IDs are positive safe integers and increase monotonically per VM. Failed calls
may consume an ID. Exhaustion raises `ExecutionLimitException` before an unsafe
identity can be admitted. Restore never lowers the VM's sequence, so frames
created after a capture cannot accidentally reuse identities on another replay.
An address captured with the snapshot may resolve the restored frame with that
same identity; it never retains a direct alias to the abandoned frame's storage.

Managed addresses remain VM-owned. `arg` and `local` addresses resolve the index;
field, array, box and static addresses keep their existing owner/slot validation.
An interior struct address resolves its immutable field path afresh after lookup.
Returning an owning frame expires its stack addresses immediately, even when the
pool still retains that frame until the enclosing instruction finishes reading it.

## Root visibility

Frame indexing does not keep managed objects alive. The existing visitor owns
the root inventory, including active and parked frames and pending retired
storage. During context enqueue, `vm.frames` temporarily contains the new stack;
the scheduler's saved parent stack therefore remains an independent root group.
It must be scanned until admission succeeds or rolls back. A failed child cannot
retain its managed references through either the identity index or pooled slots.

## Host mutation and restoration

Hosts may inspect frames and use the supported debugger/storage APIs. Direct
editing of frame IDs, frame-array membership, scheduler contexts or ownership is
unsupported. Constant-time membership guards reject addresses whose original
array slot or live owner has disappeared; inserting a detached frame into another
array does not admit it. A saved scheduler context continues owning its frame
array until that context is explicitly retired.

Complete snapshots are the supported mechanism for changing execution topology.
The captured active stack and current context must describe the same IDs. All
other live contexts require distinct IDs within the captured sequence; terminal
contexts may not retain frame arrays. Preflight rejects duplicate, zero, unsafe,
out-of-sequence and conflicting context identities before changing live state.

## Qualification

The focused regression file is `tests/a05-live-frame-index.test.js`. It exercises
source execution, reloaded source assemblies and direct CIL execution; existing
managed-address, frame-pool, root-visitor, context and snapshot suites cover the
surrounding contracts. The bounded lookup test installs throwing iterators after
admission, establishing that lookup does not scan the frame graph. It is an
algorithmic check, not a measured latency claim.

Run serially through the repository wrapper:

```sh
node scripts/limited.js node --test tests/a05-live-frame-index.test.js tests/a05-managed-address.test.js tests/a05-frame-pool.test.js
node scripts/limited.js node --test tests/a05-frame-root-visitor.test.js tests/a05-context-events.test.js tests/a05-source-context-events.test.js tests/a05-seams-snapshot.test.js
```

Fresh validation and performance measurements are pending the coordinated A05
serial slot. Native CLR, browser engines and Rust/Wasm execution are not qualified
by these Node tests. No root-scan or dispatch speedup is claimed by this batch.
