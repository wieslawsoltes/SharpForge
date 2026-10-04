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
or inferred for this slice. The initial run passed 83 of 85 tests. Reload exposed
two existing emitter inconsistencies: `decimal` and `System.Decimal` caused
redundant argument spills and separate scratch slots. Scalar aliases are now
normalized before deciding conversions and allocating scratch storage; canonical
byte verification remains unchanged.

All 85 focused tests below passed after the repair at `6da2ec81`, using Node 24,
one worker and a 512 MB old-space limit. Broad platform/performance qualification
remains deferred.

Completed focused validation:

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
from the pinned contract; no new native capture or execution is claimed. All
102 focused Parse, rounding, Decimal operation/adapter/CIL and source numeric
tests passed at `fc5592bf`, after integrating the merged rounding parent. The
run used Node 24, one worker and a 512 MB old-space limit. Broad platform and
performance qualification remains deferred.

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
beyond Number's exact integer range, storage, and rejected signatures. All 47
focused integral-rounding, Round/Truncate, Parse and Decimal-operation tests
passed at `3772537a`, using Node 24, one worker and a 512 MB old-space limit.
Native/platform/performance qualification remains deferred. This family does
not close #1350 or #1351.

## Static arithmetic methods

Add, Subtract, Multiply, Divide and Remainder each admit the static signature
`decimal Method(decimal d1, decimal d2)`. Five IDs append after Ceiling/Floor,
with wire names `decimal.Add#2` through `decimal.Remainder#2`. The real parameter
names support named arguments without changing their source evaluation order.
The existing exact-signature adapter routes each method to `invokeDecimal` and
the same operations used by Decimal operators. No new arithmetic implementation
or numeric policy is introduced.

```csharp
using System;
decimal amount = decimal.Add(d2: 0.2m, d1: 0.1m);
Console.WriteLine(amount); // 0.3
Console.WriteLine(decimal.Divide(1m, 3m)); // 0.3333333333333333333333333333
```

Overflow and division/remainder by zero retain their managed faults, including
inside `unchecked`. The source family returns the same immutable Decimal carrier
for ordinary storage and boxing. Invalid arities or incompatible parameter and
return types remain rejected. Compare/Equals and other library families are not
registered by this arithmetic increment; the following comparison family adds
only their two static Decimal signatures.

`tests/a05-source-decimal-arithmetic.test.js` compares static methods and operators
across source, reloaded source and direct CIL, including exact scale, large values,
named-argument side effects, value storage and fault boundaries. All 38 focused
arithmetic, integral-rounding, Round/Truncate and Decimal-operation tests passed
at `352d3ce1`, using Node 24, one worker and a 512 MB old-space limit. No fresh
native execution, platform or performance evidence is claimed; #1350/#1351
remain open.

## Static comparison methods

`decimal.Compare(decimal d1, decimal d2)` returns Int32 -1, 0 or 1;
`decimal.Equals(decimal d1, decimal d2)` returns Boolean. Their IDs append after
the arithmetic family as `decimal.Compare#2` and `decimal.Equals#2`.

Each private registration row selects its exact expected result type as well as
owner, staticness and parameter types. Existing rows keep their Decimal result.
The builtin result metadata uses that selected descriptor; it does not invent an
operand or result conversion or admit additional profile members. The existing
intrinsic keeps Boolean values in source execution and the CLI Boolean stack
representation in direct CIL. Emission and reload retain the exact signature.

Comparison ignores representational scale and the sign of zero, while preserving
the full Decimal coefficient. Named arguments `d1`/`d2` keep source evaluation
order. Instance Equals/CompareTo and object overloads remain outside this source
family.

```csharp
using System;
int order = decimal.Compare(1.00m, 2m); // -1
bool same = decimal.Equals(1.0m, 1.00m); // true
Console.WriteLine(order);
Console.WriteLine(same);
```

`tests/a05-source-decimal-comparison.test.js` authors source/reloaded/direct-CIL
cases for scale, signed zero, close large values, typed result arrays and boxes,
branching, named-argument effects and rejected operand/result signatures.
All 39 focused comparison, arithmetic, rounding, and Decimal-operation checks
passed at `ace585df2a8a693ea7a45b43fd0535b364972801`, using Node 24, one worker,
and a 512 MB old-space limit. Platform/performance qualification remains deferred;
no new native evidence or completion of #1350/#1351 is claimed.
