# Source and reloaded-source stack byte admission

The optional `maxStackBytes` policy now covers `VirtualMachine`, whether constructed
from a source image or a reloaded emitted assembly. The [CIL policy](cil-stack-byte-budget.md)
remains unchanged. Omission preserves the prior execution policy and avoids storing
source stack-proof copies.

Each source frame reserves a 16-byte logical header, eight bytes per verified
peak evaluation slot, and its declared local storage rounded to eight-byte slots.
Arguments and the instance receiver already occupy source locals and are charged
once. Decimal locals occupy sixteen bytes. Native primitives retain the configured
ABI and the policy's eight-byte minimum logical slot.

Source frames share an operand array. Its contents are **not charged again**:
the sum of per-frame peak reservations covers every live segment. A suspended
caller keeps its full reservation while a callee runs, so this is conservative
reserved capacity, not instantaneous stack occupancy or JavaScript heap/RSS.
For example, a caller with peak two and no locals costs 32 bytes; a callee with
peak one and one Int32 argument/local costs 32. Together they require 64 bytes,
even when their shared operand array currently contains fewer than three values.
Active and parked cooperative contexts share the VM-wide limit.

The existing verifier's CFG traversal supplies peaks, including zero-height catch
and finally entry seeds. Source CALL/BUILTIN reserve their existing single result
slot, including the void/null placeholder. No second opcode-effect table exists.
`verifyImage(image, {stackBounds: true})` still returns the existing diagnostic
array and records bounds only after successful verification. The named bytecode
export `verifiedSourceStackBound(image, method)` returns a frozen `{peak}` or null;
it checks the exact image owner, method slot, instruction words and handler data
in O(code + handlers). Runtime admission caches this cold result by code epoch and
body identity. Existing opcode, operator and conversion IDs are unchanged.

Replacing a code/handler array triggers verification before dispatch. Hosts that
edit instruction words or metadata in place must call the existing public
`invalidateExecutionCode(vm, reason)` after the edit. Changed source bodies are
reverified; invalid code faults before execution. Proofs and byte accounting live
in private WeakMaps and do not enter image serialization or snapshots.

Quota rejection precedes frame allocation. Construction errors roll back pending
reservations; return, EH unwind, cancellation and stop release them. A live limit
edit is observed before pc, instruction or profiler dispatch advances. Runtime
byte-budget overflow is fatal and cannot be caught as a source managed exception.
Other source exception/debugger behavior uses the same extracted adapter.
Snapshot restore checks active and parked shared-stack segments and total reserved
bytes before changing execution or heap state. Source restoration keeps its
existing pause/resume contract.

Serial Node 24 validation at `65530cf7` passed 63 of 65 source/CIL budget,
proof, snapshot and source-dispatch tests. Two new cancellation fixtures assumed
that manually calling an entry point restarted a canceled async scheduler. They
now assert released frames, terminal contexts and fresh frame admission directly.
All 24 source-budget/proof tests passed at `6c47cb80`. No production change was
needed for those fixture corrections. Broader qualification remains staged.
Typed operand carriers, physical memory savings, performance measurements and
Rust/Wasm execution qualification remain outside this increment.
