# CIL eligibility and typed stack IR

This SF-A05-T11.1 increment exposes cold analysis of verified direct-CIL methods.
It reuses the existing CIL verifier, decode plan, MethodTables and scalar storage
guards. The numeric flow analysis and reference executor adapt the retained E02
implementation. No encoder, WebAssembly execution, tier selection, OSR, debugger
deoptimization or source-VM backend is included. Those T11 tasks remain open.

## Public API

```js
import {wasmEligibility, lowerWasmIR} from '@sharpforge/runtime';

const report = wasmEligibility(vm, vm.top.method);
if (report.eligible) {
  const ir = lowerWasmIR(vm, vm.top.method);
  console.log(ir.nativeInstructions);
}
```

Both functions accept a `CilVirtualMachine`, its actual method object, and an
optional limits object. `wasmEligibility` returns an immutable
`{eligible, reasons, ir}` record. Reasons are `{code, message, offset}` records;
method-level reasons have a null offset. An ineligible method has null `ir`.
`lowerWasmIR` returns the same immutable IR shape, or throws a `TypeError` with
the report's `reasons` property. Invalid options throw before analysis.

Analysis requires the verifier's private proof for the exact canonical body.
A copied verification report or replaced instruction array does not provide
proof. In-place operand edits require explicit code-epoch invalidation and
reverification before analysis. Closed generic methods can share that canonical body;
their concrete signature and local types drive eligibility. Normal metadata
editing still requires code-epoch invalidation and verification. Do not retain
IR across metadata changes, inspector replacement or restoration of other code.
No instruction executes during analysis; existing derived decode/type caches
may be populated. Frames, evaluation stacks and the managed heap are unchanged.

## Initial profile and reasons

The initial storage profile admits fixed-width CLI integers, Single, Double,
and resolved reference types. Calls and heap operations remain `host` nodes.
Open generics, native-width integer storage, Decimal, aggregate values, managed
addresses, typed references, indirect calls and exception regions stay on the
existing CIL execution path. Unknown external type layouts are not guessed.

| Code | Meaning |
| --- | --- |
| `WASM_NO_BODY` | No decoded instructions. |
| `WASM_UNVERIFIED` | Missing or stale exact-body verification proof. |
| `WASM_SIZE` | Instruction-count limit exceeded. |
| `WASM_ANALYSIS_LIMIT` | Stack-state, switch metadata or analysis-work limit exceeded. |
| `WASM_EH` | Exception regions require interpreter execution. |
| `WASM_STORAGE` | Unsupported local, parameter or return storage. |
| `WASM_RECEIVER` | Unsupported instance receiver storage. |
| `WASM_OPCODE` | Unsupported opcode or managed-address operation. |
| `WASM_CALL` | Unsupported call signature or constructor storage. |
| `WASM_METADATA` | Metadata resolution or analysis invariant failed. |
| `WASM_NO_NATIVE_WORK` | No reachable supported numeric candidate. |

An eligible method may contain host nodes. Eligibility means this IR can
represent the method with those fallbacks; it does not mean every instruction
can execute as a standalone Wasm operation.

## Bounds and IR contract

`maxMethodInstructions` defaults to 4096 and accepts integers 1–65536.
`maxAnalysisSlots` defaults to 262144 and accepts integers 1–16777216.
The latter bounds `instructionCount * max(1, verifiedPeak)`, using the actual
verified peak rather than an inflated maxstack header. A separate work counter
allows four times that option, charging instruction/edge metadata, transfers,
incoming state slots and merges. Switch entries are charged even when
unreachable. Exceeding either bound returns an explicit fallback reason.
State storage is O(instruction count × verified peak); work has an explicit
cap and no clock dependency. Unsupported facts and disagreeing joins become
`unknown`. There is no unbounded fixed-point iteration.

IR version 1 has `{version, token, maxStack, instructions, nativeInstructions}`.
`maxStack` preserves the CIL header. Each instruction records its `pc`, CIL
`offset`, `name`, `kind`, candidate result `type`, constant `value`, `inputs`,
`pop`, `push`, incoming `depth`, `next`, `targets` and
`requiresOperandGuards`. PCs and targets are instruction indices. `next` is the
sequential index, not a promise that execution falls through. An unreachable
instruction has null depth and remains a host node. Array fields are frozen.
Int64 constants remain JavaScript BigInts, so IR is not a JSON wire format.

Candidates cover constants, negation, integer complement and supported
unchecked arithmetic/bitwise/shift operations on i32/i64/f32/f64 carriers.
Call returns remain unknown because the existing verifier proves stack
heights rather than runtime return representations. Native-width values also
remain unknown in numeric candidates. All unary/binary candidates explicitly
require guards on their current operands before consumption. The guards must
check the existing scalar carrier, width, signed range and floating kind; a
failed guard must execute the canonical CIL handler with untouched operands.
An encoder must preserve the runtime's wrapping, rounding, signed-zero and
exception behavior. Signatures alone never authorize unchecked execution.

The internal reference executor enforces those guards and uses the shared
numeric operations. Focused tests compare its result, floating carriers and
faults with direct CIL, including loops, Int64, Single and signed zero. Other
tests cover stale proof, byrefs, EH, switch targets and analysis bounds. All 49
focused eligibility, verified-stack and decode-plan regressions passed serially
with Node 24.21.0 at `58b5a3a4`. This batch does not claim a measured speedup or
a working Wasm backend. Browser/native/Rust-Wasm qualification remains staged.

The example is `node examples/runtime/wasm-eligibility.mjs` after workspace
installation. It prints eligibility without running the program.
