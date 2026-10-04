# Source Single Math.Min/Max

The source profile appends exact `System.Math.Min(float val1, float val2)` and
`System.Math.Max(float val1, float val2)` overloads. Their `Math.Min#2:Single` and
`Math.Max#2:Single` entries come after both Decimal Round mode entries, preserving
every earlier builtin ID. The eight integral entries retain their original
position. Released numeric Min/Max wire images keep IDs 3/4 and their prior
Double emission and reload mapping.

Newly compiled Single calls return Single. That permits a `float` destination
without an explicit cast and preserves Single array/boxed identity. Ordinary
overload rules also select Single for compatible float/integral arguments,
including rounding a wide integer when converting it to Single. For example,
`Math.Max(1f, 16777217L)` returns Single 16777216. A float/double pair continues
to select Double, and Decimal/float pairs remain invalid without explicit casts.
No compiler/binder ranking or conversion rules are changed.

The exact signatures and parameter names follow pinned .NET 10.0.5
[Single Max](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L934-L951)
and [Single Min](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L1082-L1099).
Existing typed Math descriptors, source intrinsic dispatch, call+nop CIL
discriminator and full canonical reload validation serve the new rows. The
[floating operand-selection prerequisite](floating-math-extrema.md) supplies
the same selected-operand, signed-zero and NaN behavior for all three engines.
There is no second floating implementation.

`tests/a05-source-single-math.test.js` authors source, reload and direct-CIL
cases for result typing/storage/boxing, named evaluation, zeros/subnormals,
finite bounds/infinities/NaNs, mixed conversions, exact decoder signatures,
invalid overloads and independently constructed old/new wire images.
The focused prerequisite separately covers selected quiet-NaN payload bits.
Tests and platform/performance qualification remain staged; no new native
capture, executed validation or performance result is claimed. Small-width and
native-sized exact Math overloads remain separate work.
