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
dup/pop, negation, add/subtract/multiply (including checked forms), and comparisons
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

Division, remainder, bitwise operations, shifts, other conversions, wide operands and
unknown verifier categories retain the existing handlers. Host-edited tags, Array
replacement, custom descriptors and frozen/sealed arrays also preserve fallback.
Write observers keep the regular BigInt notification path. The existing reference
plane, pool clearing, stack admission and restore adapters serve both numeric kinds;
saved frames remain ordinary arrays and shared local-array aliases are preserved.

This is a partial product increment for #1397, limited to direct CIL. Source and
reloaded-source interpreters retain their existing representation. The required
10-million-operation differential run, all-platform qualification and at-least-3x
counter-loop benchmark remain pending. Focused boundary/lifecycle tests are authored
but were not executed in the implementation slot; no builds or benchmarks ran.

No zero-allocation or throughput claim is made. Plan/plane/proxy setup allocates;
BigInt is materialized at public boundaries and generic fallback. The focused loop
regression inspects private lane use as a functional storage invariant, not as an
allocation measurement or benchmark result.
