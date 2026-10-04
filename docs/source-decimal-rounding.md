# Source Decimal rounding

The source compiler and VM admit `decimal.Round(decimal)`,
`decimal.Round(decimal, int)` and `decimal.Truncate(decimal)`. The same calls
work through `System.Decimal` and type aliases. The real parameter names `d`
and `decimals` support named arguments and preserve source evaluation order.

Round uses the existing Decimal midpoint-to-even implementation. Truncate
rounds toward zero. Both return the shared immutable 96-bit Decimal value,
preserve scale where the operation requires it, and retain managed faults for
invalid digit counts outside 0 through 28. No floating-point conversion or
second arithmetic implementation is introduced.

Three source builtin IDs append after the released runtime entries. Distinct
wire names (`decimal.Truncate#1`, `decimal.Round#1`, `decimal.Round#2`) identify
the overloads without adding C# members or entering legacy name-only lookup.
Their frozen `decimal` descriptors reference the existing CIL intrinsic
profile and `parameterNames` supplies source parameter spelling. Existing builtin
IDs and opcode IDs are unchanged. The CIL emitter emits ordinary static Decimal
MemberRefs, and reload matches owner, name, staticness, return type and every
parameter. Generic, vararg and other unsupported signatures remain rejected.

```csharp
using System;
decimal amount = 1.245m;
Console.WriteLine(decimal.Round(amount, 2)); // 1.24
Console.WriteLine(decimal.Truncate(-1.99m)); // -1
```

This is a partial #1350/#1351 increment. MidpointRounding overloads, Decimal
Math overloads, TryParse and the other Decimal library APIs remain outside
the source profile. The following Parse increment adds only its string overload.
Direct CIL retains its existing broader intrinsic profile.
The existing legacy builtin emission function moved into a focused module with
its previous mappings preserved.

Tests in `tests/a05-source-decimal-rounding.test.js` exercise source, reloaded
source and direct CIL, named arguments, scale, extremes, storage, invalid digit
counts and signature rejection. One Round case consumes the existing hash-checked
.NET 10.0.5 / SDK 10.0.201 macOS-arm64 capture; no native output was regenerated
or inferred for this slice. New tests and platform/performance qualification have
not been run and remain in the serial validation queue.

Scheduled focused validation:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-source-decimal-rounding.test.js tests/a05-decimal-adapters.test.js tests/a05-decimal-cil.test.js tests/a05-source-numeric-modes.test.js tests/a00-01-value-abi.test.js
```

## Parsing strings

The subsequent `decimal.Parse(string s)` source builtin appends one ID,
`decimal.Parse#1`, after the three rounding entries. Source, reloaded source and
direct CIL use the existing `invokeDecimal` profile and shared parser. Named
argument `s` is supported. Parsing produces the same immutable Decimal value
used by arithmetic, storage and boxing; coefficients never pass through Number.

This profile parses bounded invariant Number-style text: decimal point `.`,
group separator `,`, leading or trailing signs, and ASCII whitespace U+0009–000D
or U+0020. A final run of NUL characters is accepted. NUL followed by whitespace,
interior NUL, NBSP and BOM remain invalid. Null produces ArgumentNullException;
invalid text produces FormatException; an out-of-range magnitude produces
OverflowException. More than 4096 input characters is an explicit runtime limit
and produces FormatException. This limit is not claimed as a .NET limit.

The two text-boundary repairs follow the pinned
[.NET 10.0.5 Number parser](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/Common/src/System/Number.Parsing.Common.cs#L262-L288).
The [Decimal entry contract](https://github.com/dotnet/runtime/blob/v10.0.5/src/libraries/System.Private.CoreLib/src/System/Decimal.cs)
uses Number-style parsing. The profile remains invariant: it does not implement
current-culture selection or provider/NumberStyles/span overloads. Exponents and
currency strings are rejected by Parse. The standalone `decimalParse` helper
retains its existing explicit exponent option; that option does not widen the
source or CIL intrinsic contract.

```csharp
using System;
decimal amount = decimal.Parse(s: "1,234.5000");
Console.WriteLine(amount); // 1234.5000
```

`tests/a05-source-decimal-parse.test.js` covers scale, rounding, extrema, signed
zero, string/value storage, null/format/overflow faults, precise whitespace/NUL
boundaries, the length cap and rejected overloads. These expectations derive
from the pinned contract; no new native capture or execution is claimed. The
test file and existing Decimal helper/adapter/CIL tests are queued for serial
validation. All broader platform and performance qualification remains open.

## Directed integral rounding

The next family appends `decimal.Ceiling(decimal d)` and `decimal.Floor(decimal d)`
after Parse. Their wire names are `decimal.Ceiling#1` and `decimal.Floor#1`.
Ceiling rounds toward positive infinity; Floor rounds toward negative infinity.
They retain the existing Decimal descriptor, carrier and directed-rounding
implementation. No parser or numeric semantics change in this increment.

Aliases, named argument `d`, ordinary integral-to-Decimal argument conversions,
array storage and boxing use the same source adapters. CIL emission and reload
match the exact static Decimal signature. System.Math overloads remain outside
this source family; incompatible arguments and extra parameters are rejected.

```csharp
using System;
Console.WriteLine(decimal.Ceiling(d: -1.25m)); // -1
Console.WriteLine(decimal.Floor(d: -1.25m));   // -2
```

`tests/a05-source-decimal-integral-rounding.test.js` adds source/reloaded/direct-CIL
cases for both signs, values near zero, scale, maximum/minimum values, precision
beyond Number's exact integer range, storage, and rejected signatures. Tests have
not run; native/platform/performance qualification remains deferred. This family
does not close #1350 or #1351.
