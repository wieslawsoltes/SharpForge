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
No speedup or completed cross-platform qualification is claimed. Token/virtual-call caches and source
superinstructions are subsequent T07 slices; they will consume the same epoch owner.
