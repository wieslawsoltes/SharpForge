# CIL handler decode plans

Direct CIL execution resolves each verified method's opcode handlers once per VM
code generation. Subsequent instructions index that handler array. The existing
CIL handler registry still defines semantics; original instruction objects remain
visible to debugger callbacks, and frames reuse the existing `methodOffsets`
cache. Instruction counts, slice budgets, call initialization and exception
dispatch remain at their existing boundaries.

Decode plans are enabled by default. Set `decodePlans: false` in
`CilVirtualMachine` options to retain the original per-instruction handler lookup.
That path does not construct decode plans. The source interpreter is unchanged.

Ordinary dispatch allocates only the handler array and a frozen array of original
instruction references. Optional numeric opcode IDs, operand indexes, branch PCs
and switch PCs are allocated lazily on their first diagnostic read. Operand values
remain separate so Int64 values and floating-point signed zero are preserved. Plan and handler arrays are frozen; diagnostic reads
of numeric buffers return copies. Instructions and the shared offset map retain
their existing metadata identity. Branch handlers still consume their original
operands through that shared offset map; branch-PC execution and specialized
numeric handlers are separate follow-ups.

Plans belong to an internal weak cache, not VM fields or frame state. Snapshots
do not acquire handler functions or cache fields. Successful CIL restore and
`stop()` invalidate derived plans; rejected restores leave them untouched.
Inspector/type-registry replacement changes the code epoch automatically. A
method's replacement instruction array gets a fresh plan and offset map. CIL Hot
Reload already replaces the inspector and therefore changes that epoch.

Two named runtime exports expose cache lifecycle and diagnostics:

- `invalidateExecutionCode(vm, reason = 'explicit')` discards derived code caches
  and returns the new numeric epoch. Call it after a committed in-place opcode
  or operand edit. Edits to instruction boundaries must replace the instruction
  array so the existing offset-map cache also refreshes. This API does not
  verify edited code or make invalid IL executable.
- `executionCodeStatistics(vm)` returns a frozen current-generation record with
  `epoch`, `reason`, `decodePlans`, `decodedInstructions`, `decodeMilliseconds`
  and `offsetMapAllocations`. Decode time is elapsed host milliseconds, not CPU
  time. The offset counter records maps allocated while constructing plans;
  frames normally obtain their shared offset map earlier, when entering a call.

This is a partial SF-A05-T07 implementation. It reuses the assembled E02 decode
and code-version modules without pulling in frame pooling, typed numeric stacks,
token/PIC caches, source fusion or Wasm tiering. No throughput improvement,
allocation-free execution or full T07 completion is claimed. Focused tests cover
handler reuse, on/off execution parity, pause/budget boundaries, code replacement,
Hot Reload, rejection paths and snapshot replay.

Serial validation initially passed 112 of 113 tests at `47812bd7`; the remaining
fixture set a static verifier limit below its method size, so it never exercised
runtime exhaustion. A one-instruction loop now admits that method and asserts
failure on the sixth attempted instruction with a budget of five. All 11 decode
tests then passed at `0d18e1c9`; production code was unchanged by the fixture fix.
The initial batch also covered offset caches, EH/snapshots, method events,
scheduled cancellation, delegates, small storage and the value ABI.

Node 24.21.0 used the serial resource wrapper with a 512MB heap. Syntax/import
checks passed across 1,859 modules; the non-strict structure report retained
264 repository warnings. Performance and broader platform measurements remain
pending; these checks do not qualify the T07 throughput targets.
