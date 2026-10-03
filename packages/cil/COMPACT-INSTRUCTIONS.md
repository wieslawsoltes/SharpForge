# Compact instruction helpers

`new CilWriter(capacity, { compact: true })` opts into compact encodings for the
existing `local(name, index)` and `integer(value)` helpers. The default remains
byte compatible, including compiler emission and canonical source-VM replay.

The generic `ldarg`, `ldloc` and `stloc` helpers use operand-free forms for indices
0–3. Those helpers plus `ldarga`, `starg` and `ldloca` use byte-index forms through
255 and the original 16-bit forms above it. Existing index bounds remain 0–65535;
metadata/local-count validity is a separate verifier concern. Explicit `op(...)`
encodings, including explicitly requested short forms, remain unchanged.

Compact `integer` accepts signed int32 values or unsigned 32-bit bit patterns.
It preserves all bits, including `4294967295` as `ldc.i4.m1`, and uses constant
macros for −1 through 8, `ldc.i4.s` for the remaining signed-byte range, and
`ldc.i4` otherwise. Non-integers and values outside the 32-bit range throw CilError.
Each selection is O(1), uses fixed lookup tables and allocates no per-instruction
selection objects or strings.

Selection happens when the helper writes bytes. `length`, numeric branch patches,
labels and switch fixups therefore observe the final instruction sizes immediately;
finish does not relocate code. Symbolic branch relaxation, automatic high-level
compiler emission, and EH/debug relocation remain separate work under #2389.

Focused boundary tests and a direct CIL/native CLR fixture are prepared; validation
is pending its serial slot. Ordinary metadata fixtures do not carry the source-VM
profile. Existing source-VM output is preserved and covered by compatibility tests.
