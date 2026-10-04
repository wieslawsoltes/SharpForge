# CIL Math.Sign scalar overloads

The direct CIL intrinsic profile admits the exact static `System.Math.Sign`
overloads for SByte, Int16, Int32, Int64, Single and Double. All six return an
Int32. Integer minima return -1 without a negation or absolute-value overflow;
Int64 comparison preserves its BigInt carrier. Single inputs round at their
declared parameter boundary. Either floating zero returns integer zero,
infinities return their sign, and floating NaN raises managed ArithmeticException.

These contracts follow pinned .NET 10.0.5
[Math.Sign implementations](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Math.cs#L1311-L1374).
The invariant exception message uses the same
[Arithmetic_NaN resource](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/Resources/Strings.resx#L1994-L1996).
The handler returns a primitive Number Int32, including for Int64 and floating
inputs. It reuses existing scalar unwrapping and small-integer parameter storage;
no carrier, arithmetic algorithm, bytecode ID or source overload is changed.

Admission requires the exact owner, parameter type, Int32 result and static
signature. No unsigned signature is invented. Existing Decimal Sign remains on
its Decimal implementation. Native-sized Sign, MathF, and source overload
registration are separate work; this leaf does not claim full T01 completion.

`tests/a05-cil-math-sign.test.js` authors independent CIL for boundaries, signed
minima, subnormals, zeros, infinities and NaN, typed Int32 storage/boxing across GC,
managed NaN catches, and false signature rejection. The shared handler also has
both-sign quiet-NaN and wider floating-stack-to-Single cases. Validation and
native/platform/performance evidence remain staged; no new execution result or
performance measurement is claimed.
