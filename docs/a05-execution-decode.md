# CIL decode plans and code epochs

`getDecodePlan(vm, method)` derives opcode IDs, operand-pool indexes and branch PCs once per closed
method instance and VM code generation. The opcode values come from `CilOpcodes`. Int64 and floating
operands remain exact entries in `operandValues`; the Int32 operand array contains indexes, not narrowed
values. Switch targets have their own instruction-index arrays. Existing instruction objects remain the
debugger and exception-location identity. Offset maps are shared with frame construction.

The CIL step dispatch indexes a frozen handler array. It does not look up an opcode name in the handler
Map. Numeric specialization contributes verified handlers before that array is frozen. The private cache
has a last-method fast path; switching methods uses a token-indexed map of weak method identities so
different closed generic instantiations retain different numeric facts.
The optional typed-numeric frame adapter runs after plan lookup and before the program counter advances;
changing either numeric execution option rebuilds the method's plan.

Nonempty native typed arrays cannot be frozen in JavaScript. The plan keeps canonical arrays private and
returns independent Int32Array copies when `opcodeIds`, `operands`, `branchTargets` or `switchTargets`
are inspected. The execution loop does not read those copying accessors. Original instruction objects and
the existing offset Map remain code-owner metadata; code changes must replace the owner or invalidate it.

The runtime exports `invalidateExecutionCode(vm, reason = 'explicit')`, returning the new numeric epoch,
and `executionCodeStatistics(vm)`, returning frozen cold-decode counters and elapsed milliseconds.
Inspector/image replacement advances the epoch automatically. Successful debugger Hot Reload and VM
stop explicitly invalidate it. Rejected edits leave it unchanged. Derived caches never enter VM/frame
snapshot fields; a fresh VM reconstructs them after portable restore. No host callbacks enter snapshots.

Qualification is deferred until the complete E02 integration is ready. `tests/a05-decode-plan.test.js`
prepares exact operand, warm-allocation, owner replacement, Hot Reload and portable restore cases.
`node scripts/benchmarks/a05-decode.mjs [output.json]` prepares cold-decode and warm-dispatch evidence.
No speedup or completed cross-platform qualification is claimed. Virtual-call caches and source
superinstructions are subsequent T07 slices; they consume the same epoch owner.

`token-cache.js` caches raw tokens, user-string text, type names and resolved method/field descriptors.
Closed caller methods and receiver MethodTables are separate substitution keys. Field entries contain
the immutable descriptor and slot index, never a managed receiver or heap record. Every field access
checks the current reference and reads its current storage, including after GC or snapshot restore.
Verified method membership uses an epoch-owned Set. A replaced MethodTable registry also invalidates
derived code state. The metadata-only field cache follows the design from PR #2804; its independent
field-assembly fixture is reused for closed generics, reused tokens and restored storage.
`tests/a05-token-cache.test.js` prepares warm-path zero-resolution and invalid receiver cases; execution
and performance measurements remain deferred.
