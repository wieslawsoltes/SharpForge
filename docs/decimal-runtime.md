# Decimal execution

The shared bytecode Decimal helpers represent a value as a frozen record with
`decimal: true`, unsigned 96-bit BigInt `coefficient`, `scale` from 0 through 28,
and independent boolean `negative`. Values retain representational scale and the
sign of zero; numeric comparison ignores both. Arithmetic never converts the
coefficient to Number. Integer conversions truncate and check their destination
bounds. R4/R8 conversions follow the .NET 10 CoreLib rounding policy. The runtime
entry seam is `execution/decimal.js`; the public bytecode exports are shared by
both execution engines.

`decimal`, `decimalFromBits`, `decimalParse`, integer/float conversions, arithmetic,
comparison, rounding and formatting accept optional managed fault adapters.
Standalone callers receive Errors whose names match the managed exception type.
Formatting supports invariant G, F, N, E and P with precision 0–99. Parsing is
bounded to 4096 characters. Provider/culture overloads are not registered.

This change reuses the assembled A05 E01 arithmetic implementation. It does not
establish new platform or performance evidence. Focused tests and native reference
replay are staged for the serial qualification queue; source frontend integration
is paired with T01.8, and #1350 remains open until both engines are qualified.
