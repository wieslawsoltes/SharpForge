# Exact integral source Math.Min and Math.Max

Eight source entries expose `System.Math.Min` and `Max` for `int`, `uint`, `long`
and `ulong`. Each entry has the actual two same-width parameters, matching result
type and parameter names `val1`/`val2`. They append after the existing Decimal
Math.Sign entry and use unique wire names such as `Math.Min#2:UInt64`.

The existing registry bridge exposes these descriptors as overloads. Source
execution uses the same intrinsic dispatcher as direct CIL, including unsigned
comparison for UInt32/UInt64 and exact BigInt comparison for Int64. No binder
ranking change or alternate arithmetic model is introduced.

Released `Math.Min`/`Math.Max` IDs 3/4 keep their numeric operands/results and
remain usable by legacy images and the legacy compiler. The semantic bridge's
existing Double overloads still use those entries. Single and mixed Double calls
retain that existing admission path; exact Single source overloads are separate
work. The legacy source Min/Max adapter now unwraps tagged floating operands
before passing them to host Math and still returns a Number.

Typed calls emit an ordinary exact MemberRef call followed by a terminal `nop`
inside the existing source instruction span. This follows the no-op discriminator
convention already used by explicit conversions and checked unary operations.
It is needed because released Int32 calls already emit the same MemberRef as the
new typed Int32 entry. Unmarked released calls still reload to IDs 3/4. The typed
decoder requires the exact declaring owner and complete signature, one terminal
`call`, and its single terminal `nop`; full canonical assembly re-emission validates
all adaptation instructions and metadata before returning an image. The marker
does not make arbitrary external call/nop sequences admissible.

`tests/a05-source-integral-math.test.js` authors source/reload/direct-CIL coverage
for full-width boundaries, declared result storage/boxing, named evaluation order,
mixed numeric calls and floating carriers. Independent wire images cover old/new
ID preservation, and a modified widening instruction exercises complete canonical
span rejection. The earlier Decimal Sign coexistence test now expects exact
integral IDs for new semantic calls; its double paths keep their old IDs.

This leaf requires the unsigned CIL Min/Max prerequisite. It does not add Decimal
Min/Max, native-sized overloads or small-width/Single source overloads. Future
Decimal overload work must also consider previously admitted mixed signed/unsigned
arguments, rather than assuming same-width overloads settle every mixed call.
Validation, native/platform evidence and performance measurements remain staged;
#1350/#1351 remain open.
