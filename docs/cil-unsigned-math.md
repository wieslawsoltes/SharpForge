# Unsigned CIL Math.Min and Math.Max

The direct CIL profile admits four exact static `System.Math` signatures:
`Min(uint, uint) -> uint`, `Max(uint, uint) -> uint`,
`Min(ulong, ulong) -> ulong`, and `Max(ulong, ulong) -> ulong`.
The method owner, both parameter types, result type and staticness must match.

The runtime reuses the existing UInt32 and unsigned Int64 comparison helpers.
Comparison interprets the bits as unsigned; selection returns the original
operand, retaining the signed I4 Number or signed I8 BigInt stack representation.
Declared storage, boxing, formatting and host-result conversion continue to
apply their existing UInt32/UInt64 contracts. Equal operands select the first
operand, matching the pinned [.NET 10.0.5 Max implementations](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L961-L975)
and [Min implementations](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L1109-L1123).

This is a prerequisite for later typed source Math registration. Source builtin
IDs, overload symbols and reload emission are unchanged; existing signed and
floating CIL overloads retain their handlers. This leaf does not expose unsigned
Math source overloads or Decimal Min/Max, and does not complete T01.7/T01.8.

`tests/a05-cil-unsigned-math.test.js` authors ordinary CIL cases for zero, maximum,
the signed/high-bit boundary, equal operands, both operand orders, raw stack and
host results, fields, arrays, boxing, GC retention and malformed MemberRefs.
It also checks that existing signed/floating signatures retain their handler.
All 69 focused unsigned-Math, UInt32/Int64 arithmetic and CIL-intrinsic checks
passed at `4fc54923b` with Node 24.21.0, one worker and a 512 MB old-space
limit. Existing native fixtures were consumed; no new native run occurred.
Native/platform qualification remains deferred; no performance or allocation
improvement is claimed.
