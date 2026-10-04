# Decimal Math.Min and Math.Max

The source profile adds `System.Math.Min(decimal val1, decimal val2)` and
`System.Math.Max(decimal val1, decimal val2)`, both returning Decimal. Their
wire entries append after the eight integral Math entries; every existing ID
and legacy serialized call mapping stays unchanged. Existing exact descriptors,
runtime operations and CIL emission/reload adapters serve all three engines.

The [.NET 10.0.5 Math methods](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L869-L873)
delegate to Decimal selection. Its [pinned implementation](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Decimal.cs#L1169-L1181)
chooses the second operand for equal Min inputs and the first for equal Max
inputs. The existing runtime already follows that rule, retaining the selected
operand's coefficient, sign and scale, including differently encoded zeros.

## Correction of previously over-admitted mixed calls

The old incomplete profile accepted `Math.Min(longVariable, ulongVariable)` and
`Math.Max(intVariable, ulongVariable)` by selecting Double. They are ambiguous
under the actual .NET overload set. This conclusion comes from primary-source
inspection, not a newly executed native compiler oracle:

- [C# §10.2.3, pinned specification](https://github.com/dotnet/csharpstandard/blob/107068a0fee88b13e9c46ff64f98343ff29ff8ee/standard/conversions.md#1023-implicit-numeric-conversions)
  permits those integral types to convert to floating types or Decimal, but
  provides no implicit conversion between Decimal and Double/Single.
- [§12.6.4.5–7](https://github.com/dotnet/csharpstandard/blob/107068a0fee88b13e9c46ff64f98343ff29ff8ee/standard/expressions.md#12645-better-conversion-from-expression)
  supplies no better conversion between those candidate targets.
- [§12.6.4.1](https://github.com/dotnet/csharpstandard/blob/107068a0fee88b13e9c46ff64f98343ff29ff8ee/standard/expressions.md#12641-general)
  requires a unique better member. Without one, invocation is ambiguous.

New compilations therefore report `CS0121`. An explicit cast expresses the
intended domain, for example `Math.Min((double)signed, unsigned)` or
`Math.Max((decimal)signed, unsigned)`. The predecessor's two mixed-variable
positive assertions now include that cast; new diagnostic tests retain the
uncast cases. This corrects an incomplete-library admission, without modifying
binder ranking or inventing mixed-type CLR signatures. Previously serialized
legacy ID 3/4 images keep their existing runtime and reload behavior.

`tests/a05-source-decimal-extrema.test.js` authors source/reload/direct-CIL cases
for full Decimal range, exact precision, scale, signed zeros, named evaluation,
arrays/boxing, valid small/wide/mixed inputs, explicit casts and signature
rejection. Existing integral and legacy wire round-trip coverage remains in
`tests/a05-source-integral-math.test.js`.

Only these two Decimal overloads are added. Existing small-width/Single source
profile limitations and broader T01 qualification remain open. No new native,
platform or performance results are claimed; validation is queued separately.
