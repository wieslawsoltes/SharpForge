# Safepoints and cooperative polling

The numbered kinds are a stable ABI, consumed by `fixtures/safepoint/expectations.json` and body exports:

1. Back-edge: materialize branch operands before the target instruction.
2. Call/return: publish receiver, arguments and return/unwind value before any allocation or callback.
3. Allocation: publish explicit inputs before reserve/collect; no newborn object is assumed rooted before installation.
4. Slice end: persist PC, stack height/values, locals, arguments, frame IDs, exception continuations and pending faults.
5. Scheduler yield/park: commit context and awaited task, clear active state only after parked roots are discoverable.

Both JS VMs execute cooperative slices. Default slice limits are 15,000 instructions and 8ms; time is polled every 256 instructions. CooperativeScheduler defaults to a 256-instruction quantum; Yield sets steps to quantum; beforeInstruction dispatches resumed faults and afterInstruction switches contexts. Instruction exhaustion is a fatal fault, not a scheduling yield. Neither time budget guarantees a hard wall-clock pause inside a synchronous host callback.

The runner uses instructionBudget=1 and GC before/after every instruction (a superset of kinds 1,2,4,5), and forces collection at reserve with allocation roots (kind 3). It exercises both real JS VMs, including parked-frame live markers. It cannot qualify Rust/native stack maps or operating-system preemption. Back-edge fixture uses actual source loops in the regression suite.
