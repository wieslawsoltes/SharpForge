# Logical CIL stack byte admission

`CilVirtualMachine` accepts an optional `maxStackBytes` safe integer of at least
16. Omission keeps the existing policy. The limit applies to the whole VM:
active and parked cooperative contexts share it. It supplements `maxFrames` and
`maxStackValues`; it does not change verification or permit a malformed maxstack.

A frame costs a 16-byte logical header, eight bytes for each reserved evaluation
slot, and metadata-sized arguments/locals rounded up to an eight-byte slot.
References, managed addresses and primitive values therefore consume at least
eight bytes; Decimal storage consumes sixteen. Instance receivers and closed
generic signatures are included. Admitted user structs and Nullable values use
their aligned layout, including nested fields and padding. A struct containing
two Decimal fields reserves 32 bytes; three byte fields reserve one eight-byte
logical slot. The same calculation applies to snapshot preflight.
This is managed accounting, **not JavaScript
heap/RSS usage**. Pool retention and temporary call argument buffers have their
existing separate budget. There is no change to the Array-based operand carrier.

Verified evaluation capacity is `min(method.maxStack, maxStackValues)`, matching
existing pooled storage reservation. An inflated but valid CLI header can consume
more byte budget than its reachable evaluation peak. A body without a current
verification proof reserves the full checked `maxStackValues` fallback capacity.
Only verified instructions retain the existing omitted push-limit comparison.

Admission reserves bytes before acquiring frame storage, and failed construction
rolls back the reservation. Return, exception unwind, context disposal and stop
release charges. Accounting is private derived state, with no new VM/frame fields
or snapshot schema. Snapshot restore preflights active and parked frames before
mutating execution state, then reconstructs accounting from the restored graph.
Changes to a host byte limit take effect before the next dispatched instruction.
Budget overflow is the existing fatal `StackOverflowException` category.

This is the CIL increment alongside #1401. The [source/reloaded-source follow-up](source-stack-byte-budget.md)
documents shared-stack admission. [Optional typed float slots](typed-float-slots.md)
are available separately; wider #82 qualification remains open.
No throughput, allocation-rate or physical memory improvement is claimed.
All 95 focused byte-budget, verified-stack, pooled-frame, root-visitor and
call-buffer tests passed serially with Node 24.21.0 at `3a9f50ba`, with a 512 MB
heap limit and concurrency 1. Core static/build validation is recorded on the PR.
Broader platform and performance qualification remains staged.

The aggregate-layout accounting fix passed all 77 focused aggregate, CIL/source
budget, Nullable and struct-storage tests serially at `132768e3` on Node 24.
Its exact-boundary cases cover both native ABIs, nested Decimal fields, small
fields, argument admission before allocation, and atomic snapshot rejection.
