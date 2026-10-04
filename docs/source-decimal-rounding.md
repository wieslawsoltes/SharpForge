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
Math overloads, Parse/TryParse and the other Decimal library APIs remain outside
the source profile. Direct CIL retains its existing broader intrinsic profile.
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
