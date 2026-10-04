# Source scalar Math.Sign

Six source rows expose the existing exact `System.Math.Sign` overloads for
SByte, Int16, Int32, Int64, Single and Double. Each takes one parameter named
`value` and returns Int32. Rows append after Single Min/Max; all earlier IDs,
including Decimal Sign and released Min/Max wires 3/4, keep their meaning.
The [CIL prerequisite](cil-math-sign.md) supplies the shared behavior for source,
reloaded source and direct CIL: signed minima, either zero sign, subnormals,
infinities and managed ArithmeticException for floating NaN.

Source emission uses the existing exact `.math` descriptor and call+nop marker.
Reload now compares arity with the selected descriptor rather than assuming two
arguments. Owner, staticness, result, parameter types, one terminal call marker
and full canonical re-emission validation remain required. No binder ranking,
compiler lowering or numeric algorithm changes are introduced.

## Actual overload selection

The [.NET 10.0.5 API](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L1306-L1374)
has no UInt64 Sign overload. Under pinned C#
[implicit numeric conversions](https://github.com/dotnet/csharpstandard/blob/107068a0fee88b13e9c46ff64f98343ff29ff8ee/standard/conversions.md#1023-implicit-numeric-conversions),
an UInt64 argument can convert to Single, Double or Decimal. Single is better
than Double, but Single and Decimal have no better conversion between them.
[Better-conversion and member-selection rules](https://github.com/dotnet/csharpstandard/blob/107068a0fee88b13e9c46ff64f98343ff29ff8ee/standard/expressions.md#12645-better-conversion-from-expression)
therefore make `Math.Sign(ulongVariable)` ambiguous in C# (the current compiler rejects these calls, but does not consistently report `CS0121`). The same applies
to a mixed conditional expression whose result is UInt64. An explicit cast to
Decimal, Single or Double specifies the intended domain.

The earlier Decimal-only admission accepted that argument implicitly. Its
positive test now casts to Decimal, and the new diagnostic regression retains
the uncast call. This corrects the incomplete overload set; existing serialized
Decimal Sign images still reload as Decimal Sign. The former float/Double
negative tests move to positive exact-overload coverage. Byte selects Int16;
UInt16 and Char select Int32; UInt32 selects Int64. No unsigned or native-sized
signature is invented. Native-sized Sign remains a separate API increment.

`tests/a05-source-math-sign.test.js` authors three-engine result storage/boxing,
named evaluation, boundaries, faults, overload selection, explicit-cast repair,
independent old/new wire images, malformed unary signatures/markers, and full
canonical-span rejection. Validation and native/platform/performance evidence
remain queued; primary-source inspection is not a new native compiler capture.
