# Guarded Wasm binary encoding

SF-A05-T11.2 adds `encodeWasmIR(ir, options)` and asynchronous
`instantiateWasmIR(ir, helpers, options)` to `@sharpforge/runtime`.
The encoder adapts retained E02 binary emission and consumes the immutable
version-1 output of [CIL eligibility/lowering](wasm-ir-eligibility.md).
It validates IR shape, opcode/type combinations, guards, constants, stack
metadata and indexed targets before emission. It does not replace CIL
verification or confer verification proof on hand-authored IR.

The generated module has one exported void function `p<pc>` per CIL instruction,
using the retained instruction-safepoint boundary. It has type, import,
function, export and code sections, with no memory, start function or JavaScript
source generation. Binary emission follows the
[WebAssembly instruction encoding](https://webassembly.github.io/spec/core/binary/instructions.html).

`encodeWasmIR` returns a new `Uint8Array`. Instantiation returns a frozen
`{module, instance, byteLength}` record. No helper executes until the host calls
an exported function. This leaf installs no VM hooks, execution loop, tiering,
OSR, scheduler, debugger, GC or snapshot integration. Those T11 tasks remain open.
It makes no speedup claim: imports and per-instruction exported calls have costs
that have not been measured for this increment.

## Runtime import contract

The `helpers` object must contain exactly these fourteen functions; the encoder
imports them from the fixed `runtime` module:

| Helpers | Contract |
| --- | --- |
| `pop_i32`, `pop_i64`, `pop_f32`, `pop_f64` | Remove one already-guarded operand and return its Wasm-compatible Number or BigInt payload. |
| `push_i32`, `push_i64`, `push_f32`, `push_f64` | Accept a Wasm scalar and reconstruct its existing runtime carrier/storage precision. |
| `guard(pc, inputs)` | Return a boolean after checking all operands against these IR categories, without consuming/mutating them. |
| `allocate(pc)`, `field(pc)`, `array(pc)`, `call(pc)`, `host(pc)` | Execute the original CIL handler at that instruction boundary. |

The instantiation helper supplies the frozen `inputs` array to `guard` and
rejects nonboolean results before any operand is popped. Raw bytes instantiated
outside this helper instead import `guard(pc) -> i32`: the host supplies 0 or 1
and owns the same guard contract. Other helper signatures are encoded in the
module. Runtime helpers are trusted host code, not guest-provided functions.

Unary and binary entries perform a Wasm conditional guard before their first
pop. A false result invokes `host(pc)` with unchanged operands. Host-only
instructions invoke their categorized helper directly. References remain on
the host stack; no managed reference is converted to a Wasm address.
The host owns instruction-PC advancement, budgets, rooted operands, original
handler dispatch and exception propagation. Do not directly wire exports into
a VM loop without those later integration contracts.

Native entries cover unchecked fixed-width integer operations and Single/Double
arithmetic from the admitted IR. BigInt imports preserve signed 64-bit patterns;
Wasm wraps integer arithmetic and masks shift counts. Mixed Single/Double
operations promote Single before computing the Double result. The push helpers
preserve floating tags and signed zero. Checked arithmetic, division/remainder
and other operations remain host entries. An i32 shift with an i64 count also
stays on the host path, preserving the existing runtime fault behavior rather
than introducing a different result. No unsupported numeric promotion is guessed.

## Bounds and platform behavior

`maxMethodInstructions` defaults to 4096 (integer range 1–65536).
`maxBytes` defaults to 4194304 (integer range 8–16777216). The byte limit applies
to each temporary section/body and the final module; there are a fixed number
of sections and fourteen imports. Instruction input/target metadata also has
an entry-count ceiling equal to `maxBytes`. Encoding work and temporary storage
are bounded by these explicit limits. Unknown options, mutable/accessor IR,
malformed operation types and exceeded bounds reject explicitly.

Instantiation uses the standard
[WebAssembly.instantiate API](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/instantiate_static).
A missing API rejects with `code: 'WASM_UNAVAILABLE'`; compilation, linking or
host-policy denial rejects with `code: 'WASM_COMPILE'` and the original `cause`.
IR/options/helper contract errors remain TypeError or RangeError. Errors from
subsequently executing an export propagate unchanged to its host caller.
This avoids JavaScript eval/Function, but a browser's CSP must still permit
WebAssembly compilation. There is no policy bypass or fallback to dynamic JS.

Focused tests cover module validation, deterministic randomized
i32/i64/f32/f64 comparisons against shared CIL arithmetic, high-bit values,
guard-before-pop fallback, mixed precision, special floats, malformed IR,
LEB128 and byte bounds, and unavailable/denied backends. All 29 encoder and
eligibility tests passed serially with Node 24.21.0 at `2f9dc572`, using actual
Node WebAssembly execution, 512 MB and concurrency 1. Core static/build evidence
is recorded on the PR. Source VM and Rust integration are not implemented;
browser/native qualification is not claimed. The example is
`node examples/runtime/wasm-encoder.mjs` after workspace installation.
