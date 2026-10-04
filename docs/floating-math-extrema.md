# Floating Math.Min/Max operand selection

Direct CIL calls to the existing `System.Math.Min/Max(float, float)` and
`System.Math.Min/Max(double, double)` descriptors select and return the appropriate
floating operand. The prior generic JavaScript Math call could replace a NaN
operand with a different NaN encoding. The focused selector retains the chosen
immutable carrier at the declared width.

Selection follows pinned .NET 10.0.5
[Single Max](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L934-L951),
[Single Min](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L1082-L1099),
and the corresponding Double implementations in that same file: a NaN first
operand wins, otherwise a NaN second operand wins; Min selects negative zero
and Max selects positive zero when zero signs differ. Already canonical inputs
retain their original carrier. Wider floating inputs are narrowed when a Single
signature requires Single storage precision.

Only floating Min/Max dispatch changes. No intrinsic signatures, wire IDs,
integer ordering, other Math algorithms or source overloads are added. Exact
source Single registrations remain a separate follow-up. This does not claim
arbitrary signaling-NaN payload behavior across CLR/JIT/host architectures.

`tests/a05-floating-math-extrema.test.js` authors selected quiet-NaN payload/sign,
signed-zero, subnormal, finite-boundary, infinity and Single narrowing cases.
Independent managed CIL fixtures observe result bits through the existing
BitConverter intrinsics; helper tests also retain the selected carrier identity.
These are primary-source expectations, not newly captured native outputs.
Validation and cross-platform/performance qualification remain staged.
