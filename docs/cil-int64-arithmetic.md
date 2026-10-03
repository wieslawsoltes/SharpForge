# CIL Int64 arithmetic

The CIL runtime delegates 64-bit arithmetic, comparisons and unary operations to
pure helpers exported from `@sharpforge/bytecode`. They operate on BigInt values
and return signed 64-bit evaluation-stack patterns. Unsigned instructions
reinterpret the operand bits; they do not change the result representation.

The public API is:

- `int64Binary(opcode, left, right, context?)`: add, subtract, multiply, divide,
  remainder, bitwise operations and shifts. Arithmetic operands are BigInts;
  shifts also accept integral Number counts. Shift counts use their low six bits.
  Unchecked results wrap; `.ovf` operations reject overflow before narrowing.
- `int64Compare(left, right, unsigned = false)`: returns `-1`, `0` or `1` after
  interpreting two BigInt stack patterns as signed or unsigned 64-bit values.
- `int64Unary(opcode, value, context?)`: `neg` and `not`, wrapping at 64 bits.

Optional `context.fault(type, message)` and `context.error(message)` factories
preserve the runtime's managed fault objects. Standalone callers receive Errors
with managed exception names. These helpers have no VM, heap or runtime imports.

Signed `Int64.MinValue / -1` **and** `Int64.MinValue % -1` raise
`OverflowException`. Previously, the runtime returned zero for the remainder
case. Division or remainder by zero raises `DivideByZeroException`; unsigned
division and remainder reinterpret the bits and do not inherit signed overflow.

The focused regression fixture contains 22 unchanged output lines selected from
the existing .NET 10.0.5 / SDK 10.0.201, macOS arm64 oracle. Its JSON records the
source commit, original source/output SHA-256 hashes and original line numbers.
It is a bounded reference subset, not a newly generated oracle or a claim that
this branch has passed the full numeric qualification matrix.

`tests/a05-int64-arithmetic.test.js` exercises the public API and independently
authored direct-CIL methods against those results. Existing numeric seam tests
cover the adjacent paths. The serial validation queue passed 124 focused Int64,
float, numeric seam, managed IL and ABI tests on Node 24.21.0. Performance
measurements remain staged for the larger scope; no speedup is claimed. This slice does not add source-language Int64 lowering or
change Int32, floating-point, conversion, storage or native-width policies.
