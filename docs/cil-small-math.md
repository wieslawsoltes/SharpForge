# CIL small-integer Math.Min/Max

Eight exact CIL descriptors admit `System.Math.Min` and `System.Math.Max` for
SByte, Byte, Int16 and UInt16. Both parameters and the result use the same
declared type. The [pinned .NET 10.0.5 implementation](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L862-L1123)
supplies these overloads with parameter names `val1` and `val2`; Char and Boolean
are not declared overloads.

Both incoming I4 operands pass through existing `smallInteger` storage before
comparison. This preserves truncation and sign/zero extension at the declared
8/16-bit call boundary. Comparing the wider inputs first would be incorrect:
for example, I4 255 passed to SByte is -1, so Min(255, 1) at that signature must
produce -1. Results remain primitive Number I4 values and retain their declared
small type when stored, returned or boxed.

This follows [ECMA-335, sixth edition](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf),
I.12.1.2 (short integer argument/return storage), III.1.6 (implicit argument
coercion), and III.3.19 (`call`): argument passing uses the declared parameter
storage semantics. No new narrowing or comparison model is introduced.

Admission checks exact owner, staticness, parameter widths and return width.
Existing UInt32/UInt64, signed wide, floating and Decimal implementations are
unchanged. Source registration and native-sized Math APIs are separate leaves;
this direct-CIL prerequisite does not claim full T01 completion.

`tests/a05-cil-small-math.test.js` authors independent guest CIL for extremes,
equal values, zero, both argument orders, high-bit and truncation boundaries,
field/array/boxing/GC results and false-signature rejection. Tests and
native/platform/performance qualification remain queued; no new native capture
or performance result is claimed.
