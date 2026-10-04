# Optional small Int64 operand lanes

`new CilVirtualMachine(assembly, {smallLongs: true})` stores Int64 values within
`[-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]` as tagged Numbers in the
existing private typed-frame plane. Ordinary Array reads, descriptors, iteration,
debugger callbacks, calls and snapshot values continue to expose BigInt. Plain
Number writes remain ordinary Number values; they never implicitly become Int64.

The option is independent of `typedNumericStack` and `specializeNumericHandlers`.
All three reuse the existing bounded `numericPlanTypes` analysis and code-epoch
invalidation. With all options omitted, no numeric plane or category analysis is
created. No public carrier, wire opcode or snapshot schema changes are introduced.

The raw path supports Int64 constants, long/ulong local and argument loads/stores,
dup/pop, negation, add/subtract/multiply (including checked forms), division/remainder, and comparisons
and branches. Arithmetic accepts a Number result only when it is a safe integer.
Unsigned checked operations also require nonnegative operands and result. Every
declined operation uses its original operands in the existing BigInt handler,
before the raw handler consumes anything. A later exact safe result can re-enter
the lane through the ordinary Array write adapter.

Canonical Int32 operands can also widen directly into the lane through `conv.i8`,
`conv.u8` and their four checked forms. Signed forms preserve the input value;
`conv.u8` and `.un` forms use its unsigned 32-bit interpretation. Negative inputs
to `conv.ovf.u8` retain the shared managed overflow path before consuming the
operand. Actual float/native/Int64 tags and noncanonical host-edited Numbers keep
their original conversion handler, even when the verifier fact says Int32.

Division/remainder first reconstruct the candidate quotient's product and residual.
Both must be safe integers, the residual magnitude must be smaller than the divisor,
and its sign must match the dividend unless zero. These constraints establish the
exact truncating result before any operand is consumed. A zero divisor, unsigned
negative stack pattern or failed reconstruction uses the existing BigInt handler.
Wide `Int64.MinValue / -1` and `% -1` still raise the existing managed overflow.

Bitwise operations, shifts, other conversions, wide operands and
unknown verifier categories retain the existing handlers. Host-edited tags, Array
replacement, custom descriptors and frozen/sealed arrays also preserve fallback.
Write observers keep the regular BigInt notification path. The existing reference
plane, pool clearing, stack admission and restore adapters serve both numeric kinds;
saved frames remain ordinary arrays and shared local-array aliases are preserved.

Eligible integer sequences use [bounded numeric blocks](cil-numeric-blocks.md)
over the same private planes. These blocks preserve each original instruction's
quota and fault location while amortizing dispatch and stack admission. Observer
hooks and pending managed control work retain individual instruction dispatch.

This is a partial product increment for #1397, limited to direct CIL. Source and
reloaded-source interpreters retain their existing representation. The required
10-million-operation differential run, all-platform qualification and at-least-3x
counter-loop benchmark remain pending. All 97 focused boundary, lifecycle, float/Int64 coexistence,
frame-pool, root-visitor and quota tests passed at `f32fde87`. Required PR checks
follow this serial local validation; no builds or benchmarks ran in implementation.

No zero-allocation or throughput claim is made. Plan/plane/proxy setup allocates;
BigInt is materialized at public boundaries and generic fallback. The focused loop
regression inspects private lane use as a functional storage invariant, not as an
allocation measurement or benchmark result.

The Int32-widening increment passed all 42 focused conversion, small-long, Int64
and typed-float tests at `a2904830`. Required PR checks follow serial local validation;
this does not replace the deferred differential or performance qualification.

The guarded division/remainder increment passed all 52 focused tests at `cc98b65d`,
including exact quotient boundaries, fallback faults, lane lifecycle and the
unchanged native Int64 boundary fixture. Required PR checks follow serial validation;
no new native or performance run is claimed.
