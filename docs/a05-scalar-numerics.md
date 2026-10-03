# Scalar execution contract — A05 T01

This change replaces the source VM's Int32/Double-only arithmetic contract with the same scalar helpers used by direct CIL. The starting product commit is `398b0d3`. At that starting point, CIL native integers also use a hard-coded 32-bit width. Shared compiler, image, emitter, and VM adapters belong to the E01 integration commit. No validation has been run on this component in isolation; the commands below are the required assembled-scope gates.

| Capability | Runtime contract | Qualification |
| --- | --- | --- |
| Signed and unsigned integers | i1/u1/i2/u2/i4/u4/i8/u8 narrowing, exact 64-bit BigInt arithmetic, checked overflow, signed/unsigned division, masked shifts | Both engine fixtures and live .NET runner added; pending assembled validation |
| Native integer | `nativeIntBits:32` portable/browser default; explicit `nativeIntBits:64` on either VM; native-width overflow and shifts | Both widths exercised by engine tests; only the width reported by the actual .NET process counts as native qualification |
| Single and Double | Tagged r4/r8, r4 rounding on operations and storage, infinities, NaN comparisons, signed zero, .NET 10 conversion policy | Differential source/emitted CIL/Roslyn CIL cases and raw-bit observations; pending validation |
| System.Decimal | Immutable unsigned 96-bit coefficient, scale 0–28, sign including negative zero; exact BigInt arithmetic with nearest-even reduction | Arithmetic/GetBits/rounding/conversion oracle; pending validation |
| Decimal APIs | Constructors, conversions, operators, arithmetic, Round, Abs/Min/Max/Sign via Math, Compare/Equals/GetHashCode, GetBits, Parse/TryParse, ToString | Closed signatures in `numeric-intrinsic-profile.js`; pending validation |
| BitConverter | SingleToInt32Bits, DoubleToInt64Bits, Int32BitsToSingle, Int64BitsToDouble | Signed-zero and NaN boundary fixtures; pending validation |

Integer stack values remain signed Int32 Numbers or signed Int64 BigInts. Unsigned meaning comes from the declared operand type or CIL opcode. Thus source `unchecked((ulong)(int)-1)` sign-extends to the UInt64 all-ones pattern, while the existing direct `conv.u8` Int32 opcode zero-extends. Checked Decimal conversions always throw on overflow, even inside `unchecked`. The floating conversion compatibility table is [cil-numeric-conversions.md](cil-numeric-conversions.md).

Native integer values are frozen `{nativeInt:32|64,value}` records. The configured ABI controls fresh values, `conv.i`, `conv.u`, arithmetic, storage and layout; the host JavaScript architecture never silently selects it. Storage without an explicit context preserves an existing native tag's width. Passing different native widths into one operation is an invalid program. The integration must pass the ABI to defaults, field/array storage, pointer-size queries and method-table layout as well as arithmetic.

Floating values are frozen `{float:'r4'|'r8',value}` records. Decimal values are frozen `{decimal:true,coefficient:BigInt,scale,negative}` records. These records have no managed references and may be shared by value copies and snapshots. BitConverter exposes the JavaScript engine's IEEE representation; the profile promises NaN classification and unordered comparisons, not preservation of arbitrary signaling-NaN payloads through arithmetic.

Decimal operations never approximate the coefficient with Number. Reducing precision rounds once from the original full coefficient. Division extends the coefficient through scale 28 and then rounds; exact results preserve the native scale rules. Binary floating constructors use the .NET 10 seven/fifteen significant-digit conversion policy. Decimal-to-Double uses the same low-64/high-32 limb conversion order as .NET. Decimal parsing and formatting use invariant conventions. The implemented standard formats are G, F, N, E and P with precision 0–99; custom formats, IFormatProvider/culture overloads, Span APIs, UTF-8 APIs and generic-math interfaces are outside this closed API profile. Decimal text input is bounded to 4,096 characters. There is no disposable or asynchronous scalar resource; VM instruction budgets interrupt loops between bounded arithmetic operations.

## Adapter contract

`numeric-types.js` exports stable conversion IDs: int=0, double=1, sbyte=2, byte=3, short=4, ushort=5, uint=6, long=7, ulong=8, nint=9, nuint=10, float=11, decimal=12, char=13. A typed numeric mode is `16 + 2 * id + checkedBit`. BINARY and UNARY carry the promoted operand type in operand b. CONVERT carries its target ID in operand a and source mode in b. Legacy modes 0/1/2/3/5 remain readable. The enum CONVERT reservation starting at 65,536 is handled before scalar conversion by the integration owner.

`scalarBinary`, `scalarUnary` and `scalarConvert` take a context containing optional `nativeIntBits`, `fault`, `error`, and `isReference` adapters. Their modules import no heap or VM. Small source operands must first undergo C# promotion; a byte addition is an Int32 operation followed by a narrowing assignment, not byte arithmetic. Method pointers and managed references are handled by the storage adapter before entering numeric helpers.

Image constants use `encodeScalar`/`decodeScalar`: `{scalar:type,value:string}` for integers and IEEE values; Decimal uses four Int32 bits. This JSON-safe contract preserves UInt64, negative zero, infinities, NaN and Decimal scale. Compiler constant pooling, JSON serialization, loads, debugger previews and CIL emission must use that representation. Static or boxed values retain the declared type for unsigned formatting and GetType.

The descriptor-only CIL module exports `numericIntrinsicDefinitions`. Its entries use the `decimal` implementation key, including the four BitConverter entries, so the dispatch point calls `invokeNumericIntrinsic(vm, descriptor, args)`. That adapter returns `{handled,value}` and includes `invokeDecimal`. Newobj Decimal calls return the scalar record directly; an instance `.ctor` with an address writes through `vm.dereference`. Decimal `Zero`, `One`, `MinusOne`, `MaxValue` and `MinValue` come from `decimalConstants`. Root must export/register the descriptor and install both source and CIL call adapters.

## Reproducible checks after E01 assembly

Run on Node 24 with workspaces installed:

```sh
node --test tests/a05-01-*.test.js
A05_SCALAR_REPORT=/tmp/a05-scalars-dotnet.json node scripts/validate-a05-scalars-dotnet.js
node --expose-gc scripts/benchmarks/a05-scalars.mjs > /tmp/a05-scalars-perf.json
node apps/cli/main.js run examples/features-a05/scalar-numerics.cs
```

The native runner requires the .NET 10 SDK (`DOTNET_PATH` may select it), compiles fresh Roslyn assemblies, executes the CLR, and runs those exact bytes in direct CIL. It also compares source compilation and emitted CIL with each native result. Its report records HEAD, Node/SDK/runtime versions, platform, architecture, actual native width, source/assembly hashes, and unqualified widths. An emulated 32-bit VM run on a 64-bit CLR is not 32-bit native qualification. Node on Linux/macOS/Windows and Chromium/WebKit/Firefox must be reported separately by the integration owner; this component commit qualifies none of them by itself. Native 32-bit and browser-native CLR execution remain unqualified until actual target runs exist.

The benchmark records first-VM load/run time, 10 warmups, 100 warm samples, median/p95/p99, raw samples, exact logical managed allocations/bytes, and an explicitly approximate host heap delta. Its “cold” measurement is a fresh VM in the running process, not a fresh OS process. Every sample must produce the expected output. An optional baseline worktree argument compares the pre-existing Int32 and Double workloads; new scalar workloads have no corresponding old implementation. Compiler time is recorded separately. Store the report from the final assembled commit; do not substitute these unexecuted scripts for measurements.

## Pinned references

The numeric contract follows [ECMA-335, sixth edition, Partitions I and III](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf), [C# numeric conversions](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/numeric-conversions), and [C# types, sections 8.3.6–8.3.8](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/types). Decimal representation follows [Decimal.GetBits](https://learn.microsoft.com/en-us/dotnet/api/system.decimal.getbits?view=net-10.0); floating conversion and observable scale behavior are pinned to [.NET 10 Decimal.DecCalc](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Private.CoreLib/src/System/Decimal.DecCalc.cs). The implementation uses independent BigInt algorithms and the live CLR comparison is the qualification gate.
