# Source Decimal.Round modes

Two overloads append after the existing Decimal Math extrema entries:

- `decimal.Round(decimal d, MidpointRounding mode)`
- `decimal.Round(decimal d, int decimals, MidpointRounding mode)`

Their wire identities are `decimal.Round#2:MidpointRounding` and
`decimal.Round#3:MidpointRounding`. The released `decimal.Round#2` remains the
`(decimal, int)` overload at the same ID. Every earlier builtin identity remains
unchanged. The exact descriptor carries the actual CLR member name, owner,
parameter/result types and the real `d`, `decimals`, and `mode` parameter names.

The [MidpointRounding enum prerequisite](midpoint-rounding-enum.md) supplies the
five modes. Source, emitted direct-CIL and reloaded source all use the existing
Decimal intrinsic and shared rounding implementation. No new numeric carrier,
rounding algorithm, conversion policy or compiler overload-ranking rule is added.

The pinned [.NET 10.0.5 Decimal implementation](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Decimal.cs#L624-L635)
validates digits in 0–28 before validating the mode in 0–4. It validates even
when the input scale needs no reduction. Existing managed faults and scale/sign
behavior are retained, including the encoded sign of zero. Nonzero integer mode
arguments need an explicit enum cast; integer constant zero can implicitly
convert to the enum, following pinned
[C# §10.2.4](https://github.com/dotnet/csharpstandard/blob/107068a0fee88b13e9c46ff64f98343ff29ff8ee/standard/conversions.md#1024-implicit-enumeration-conversions).

The earlier Round test now selects its three released wire names explicitly,
and its rejected three-argument integer mode changes from zero to one. The newly
admitted mode signatures move out of the rejection list into positive exact
signature tests. These changes follow the completed overload set; they do not
weaken runtime validation of invalid enum values.

`tests/a05-source-decimal-rounding-modes.test.js` authors all-five-mode midpoint
and non-midpoint results for both signs, digit boundaries, full-range values,
negative-zero bits, storage/boxing, named evaluation, validation order, invalid
modes and precise signature rejection. Independently built source wire images
cover canonical emission/reload and runtime behavior for both released and new
Round entries. No native output was generated; expectations follow the pinned
contract and existing shared algorithm. Validation and platform/performance
qualification remain staged, and #1350/#1351 remain open.
