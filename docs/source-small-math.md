# Source small-integer Math.Min/Max

Eight source entries add the exact SByte, Byte, Int16 and UInt16 Min/Max
overloads. They append after all six scalar Sign entries; existing IDs and
serialized legacy or typed calls retain their meaning. Each descriptor has
same-width parameters and result, and the real names `val1` and `val2`.
The existing typed `.math` dispatch, emitter and canonical reload path reuse
the [CIL small-width prerequisite](cil-small-math.md) without a new carrier or
comparison implementation.

New source calls return the actual small type. For example, the result of
`Math.Max(byteValue, otherByteValue)` can be assigned to Byte and boxes as
System.Byte. Previously the incomplete source profile selected Int32. Old
serialized Int32 and legacy wire images keep that explicitly recorded identity;
only new overload selection changes.

The [pinned .NET 10.0.5 signatures](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L862-L1123)
declare neither Char nor Boolean extrema. Ordinary C#
[numeric conversions](https://github.com/dotnet/csharpstandard/blob/107068a0fee88b13e9c46ff64f98343ff29ff8ee/standard/conversions.md#1023-implicit-numeric-conversions)
and [better-conversion rules](https://github.com/dotnet/csharpstandard/blob/107068a0fee88b13e9c46ff64f98343ff29ff8ee/standard/expressions.md#12647-better-conversion-target)
select Int16 for an SByte/Byte pair, Int32 for Int16/UInt16, and UInt16 for
Char/Byte or Char/Char. Wider integer, Single, Double and Decimal mixed calls
keep their applicable exact overloads. No compiler or binder ranking changes
are introduced, and no Char/Boolean/native-sized overload is invented.

`tests/a05-source-small-math.test.js` authors three-engine named evaluation,
boundaries/equality, typed field/array/boxing behavior, mixed overload/result
selection, independent old/new wire images and false-signature/diagnostic cases.
Validation and native/platform/performance qualification remain queued. This
leaf completes this four-type API family; broader T01 acceptance remains open.
