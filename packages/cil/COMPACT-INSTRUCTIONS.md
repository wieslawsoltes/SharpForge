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

Validation: 198 focused CIL/compact/opcode tests pass. Native .NET 10.0.5 executes
all 14 methods in both the wide and compact fixture images with matching results.
SDK 10.0.201 captured the reference on macOS ARM64. Ordinary metadata fixtures do
not carry the source-VM profile. Existing source-VM output is preserved and covered
by compatibility tests. Required check passes (2224 syntax / 2220 static modules,
zero errors); structure reports no findings in this increment's files.

Serial paired benchmark on Apple M3 Pro / Mac15,6, Node 24.21.0 / macOS ARM64:
65,536 integer/local pairs, 2 warmups plus 7 samples, preallocated output buffer.
The before source is the exact opcode writer at ee2f9201; the after source extracts
the same writer and adds opt-in selection. Timing excludes allocation of the writer
and copying its final bytes. Sampled heap deltas are neither peak nor retained heap.

| Mode | Median ms | p95 ms | Bytes | Median sampled heap delta |
| --- | ---: | ---: | ---: | ---: |
| Before, default | 3.5563 | 6.2966 | 589824 | 19336 |
| After, default | 3.6795 | 6.6316 | 589824 | 22280 |
| After, compact | 3.8169 | 6.2469 | 324608 | 13504 |

Default median cost is +3.46%; p95 is +5.32% (+0.3350 ms). Opt-in compact median
cost versus old default is +7.32% (+0.2605 ms), reducing emitted bytes by 44.96%.
Integration performance review is recorded in the PR; these are synthetic writer
measurements, not end-to-end compiler speedup claims. Run with:
`node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-compact-instructions.mjs LABEL OUTPUT.json`.
Raw reports are under `packages/cil/benchmarks/compact-{before,after}.json`.
