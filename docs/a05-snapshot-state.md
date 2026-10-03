# Complete VM snapshot state — A05 T06

Schema 3 binds each snapshot to its VM and source image or assembly-inspector generation. Restore validates execution, heap, scheduler, synchronization, caches and platform container structure before replacing live state. Unsupported schema versions, foreign owners and stale code generations fail before mutation. Synchronization queues must refer to matching waiting contexts and tasks; monitor flags must address live Boolean storage in the saved state. Array shapes and suspended Sort/Reverse state are checked against the saved heap, including continuations in parked contexts.

A single graph-copy memo spans active frames, parked contexts, task faults, heap payloads and VM fault fields. Filter frames retain shared argument/local arrays. Code bodies, frozen MethodTables, immutable aggregate values, owned managed pointers and function-pointer owners keep identity. Frames, heap generations, scheduler context/task IDs and host handle IDs remain monotonic after rewind; a reference to discarded future execution cannot alias a later allocation.

Freezing a host wrapper does not make its nested Maps, arrays or faults immutable. Those children are copied through the same memo. Restore retains the aliases between active VM storage and the current scheduler context, and rejects conflicting copies of one frame identity before any component changes.

| Capability | Source VM | Direct CIL VM | Evidence |
| --- | --- | --- | --- |
| Nested calls, catches and finally replay | Supported | Supported | `tests/a05-06-snapshot-state.test.js` |
| Parked contexts and timer awaits | Shared scheduler state | Shared scheduler state | Same suite and `examples/runtime/parked-snapshot.mjs` |
| Managed interior addresses and value copies | Source IR adapters | Metadata typed pointers | T03/T06 suites |
| Fault aliases and active resume-fault roots | Preserved | Preserved | T06 suite |
| Monitor recursion, wait queues and intrinsic continuations | Shared synchronization and frame state | Same components | T06 and preemption suites |
| Malformed restore preflight | Schema and component checks | Schema and component checks | T06 negative cases |
| Cross-VM, portable or serialized replay | Unsupported | Unsupported | Explicit ownership and code-generation rejection |
| Replay across external I/O or worker computation | Existing host-operation revision barrier | Same barrier | Browser runtime acceptance suite |

Snapshots stay in memory. Host callbacks and immutable code metadata are retained, and external resources are not serialized or reopened. Source restore pauses execution; CIL restore restores the captured state. Restoring after a logical cancellation can replay internal scheduler work, but it does not recreate disposed external transports.

The complete E01 scope has not yet been validated. After assembly, run `node scripts/benchmarks/a05-snapshots.mjs` for first snapshot/restore, warm median/p95/p99, samples and managed-allocation deltas. The benchmark measures an existing process; it does not claim fresh-process cold startup or host JS graph allocation counts.
