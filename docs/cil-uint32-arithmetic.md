# UInt32 operations on the CIL Int32 stack

The CIL runtime uses the shared `@sharpforge/bytecode` UInt32 helpers for unsigned
Int32 arithmetic and comparisons, and for unchecked add/subtract/multiply. Values
remain signed Int32 stack patterns: the bits `0xFFFFFFFF` are stored as `-1`.
Unsigned instructions reinterpret those bits, rather than promoting the value to
Int64 or changing its storage representation.

The public API is:

- `uint32Binary(opcode, left, right, context?)`: Number operands containing i4
  bit patterns; returns a signed Int32 Number. Supports arithmetic, bitwise and
  shift operations. `.un` selects unsigned division, remainder and right shift;
  `.ovf.un` checks the mathematical result against `0..4294967295` before
  narrowing. Shift counts use their low five bits; multiplication uses
  `Math.imul` to preserve the exact low 32 bits.
- `uint32Compare(left, right)`: returns `-1`, `0` or `1` using unsigned ordering.
  Both signed stack patterns and unsigned host Numbers are accepted.

Optional fault/error factories have the same contract as the shared Int64
helpers. Overflow raises `OverflowException`, and division or remainder by zero
raises `DivideByZeroException`. The runtime's existing comparison handler routes
both comparison instructions and unsigned conditional branches through the
helper, including short branch forms.

`tests/a05-uint32-arithmetic.test.js` covers all 25 operand pairs drawn from
`0`, `1`, `0x7FFFFFFF`, `0x80000000` and `0xFFFFFFFF`. Expected results are unchanged
selections from the existing .NET 10.0.5 / SDK 10.0.201 macOS arm64 oracle. The
fixture records source/output hashes and the original line mapping; unsigned
branch expectations use the equivalent native relational operations. Separate
tests cover masked shift counts, exact multiplication, injected faults, and the
existing uint host argument/return/Console formatting contract.

This slice depends on the Int64 helper extraction for checked integer arithmetic.
It preserves the runtime's signed Int32 division/remainder, floating-point,
conversion and storage paths. Source-language lowering and full numeric
qualification are separate work. The serial queue passed 150 focused UInt32,
Int64, float, numeric seam, managed IL and ABI tests on Node 24.21.0. Performance
measurements remain staged; this implementation makes no speedup or whole-task
completion claim.
