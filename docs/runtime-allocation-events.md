# CIL allocation events

With `runtimeEvents: true`, the existing bounded log emits `AllocationTick`
after each committed CIL-heap object allocation and after positive growth of
array-backed storage. This is a logical managed allocation stream, not the
native CLR's sampled allocation-tick cadence or process-memory accounting.

Payloads contain `{bytes, growth, allocations, allocatedBytes, liveBytes}`.
`bytes` is the new object's full managed size, or the positive size delta when
`growth` is true. Growth does not increment the object-allocation count.
Same-size replacement and shrinking emit no tick. Cumulative values come from
the existing heap counters after the mutation, and timestamps use the current
VM instruction count. There are no managed handles, type tables, or heap records
in the payload. Recording an event cannot retain an otherwise unreachable guest
object.

Failed reservations emit no allocation event. If allocation first collects,
`GCStart` and `GCEnd` precede its tick; a collection can complete even when the
subsequent allocation fails. The existing profiler remains independent, including
its allocation-site attribution. Events require no profiling option and add no
VM, heap, or snapshot fields. Disabled heaps perform no event payload allocation.

Subscribers still run only at the existing host flush boundary, never inside
allocation, resizing, or collection. Their failures reach the host after guest
execution and do not become guest exceptions. Host-initiated allocations on an
instrumented CIL heap are observed as well, including entry-argument allocation;
standalone heaps and source VMs do not acquire an event log.

Snapshots rewind heap counters but retain host event history. Counts can therefore
repeat after restore; event sequence numbers remain the chronological identity.
The existing capacity, drop-oldest, replay, unsubscribe, and stop behavior applies
to these events without another observer mechanism.

For example, construct `CilVirtualMachine(bytes, {runtimeEvents: true})`, subscribe
to `vm.runtimeEvents`, and filter events whose name is
`RuntimeEventName.AllocationTick`. Run the VM through its existing slice API to
deliver queued notifications, or explicitly call `vm.runtimeEvents.flush()` at
a host boundary.

This is a partial #1403 increment stacked on the GC-event integration. Exception
and suspension events, source-VM events, and native/browser/performance
qualification remain separate. Tests in `tests/a05-allocation-events.test.js`
are authored and await serial validation; no throughput result is claimed.
