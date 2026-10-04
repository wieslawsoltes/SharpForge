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

## CIL integration

The closed Decimal member profile includes constructors, arithmetic/operators,
comparison, rounding, Parse/TryParse, integer/floating conversions, ToString,
GetBits and matching Math overloads. Member identity includes staticness and the
complete return/parameter signature. Provider/culture and generic-math interface
members outside this profile remain verifier errors.

CIL locals, fields, arrays, arguments, returns, ldobj/stobj/cpobj/initobj, and boxes
use the same immutable Decimal record. Boxing retains the existing System.Decimal
method table; unboxing requires that exact type. Readonly external Decimal constants
are recognized individually; arbitrary external field storage is still rejected.
Host arguments accept Decimal records or invariant strings, never a JavaScript
Number that could have already lost decimal precision. Snapshot copies retain the
immutable record and its scale. There is no new snapshot or portable wire format.

The saved fixture in `tests/fixtures/a05/decimal/native-reference.json` retains the
source, stdout and hashes of an existing .NET 10.0.5/osx-arm64 run from assembled
E01. It has not been regenerated or replayed in this batch. Tests independently
assemble CLI-valuetype signatures; they do not rely on source lowering.

The reference policy is the [.NET 10.0.5 Decimal implementation](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Decimal.cs)
and its [Decimal arithmetic implementation](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Decimal.DecCalc.cs).
Source VM execution and emitted/reloaded source qualification depend on the paired
T01.8 numeric-mode integration. No browser, native-platform, Rust or Wasm qualification
or performance measurement is claimed here.
