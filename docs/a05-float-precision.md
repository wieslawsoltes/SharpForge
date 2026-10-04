# Floating-point execution precision

The CIL runtime preserves Single (`r4`) arithmetic when both operands are Single,
rounding every result with binary32 precision. Mixed Single/Double operations use
Double (`r8`). Negation retains the operand width and signed zero. `ckfinite`
retains the original finite value or raises `ArithmeticException`.

The shared `@sharpforge/bytecode` exports are `float(value, kind = 'r8')`,
`floatBinary(op, left, right, context)`, `floatCompare(left, right, op, unsigned)`,
`finiteFloat(value, context)`, and `ieeeRemainder(left, right)`. Tagged values are
immutable. The optional context supplies `fault(name, message)` and, for binary
operations, an explicit `kind` override. Invalid width tags raise `TypeError`.

CLI `rem` uses a truncated quotient. The separate IEEE remainder helper uses a
nearest-even quotient; for example, `7 rem 2` is `1`, while IEEE remainder is `-1`.
The helper does not register a new `System.Math` intrinsic in this slice.

This is the arithmetic-kernel and direct-CIL portion of SF-A05-T01.5 (#1348).
Wider source-language lowering, native/browser qualification, and performance
measurements remain in the assembled E01/E02 work and are not claimed here.
