# Direct CIL numeric conversion policy

The direct `CilVirtualMachine` uses the following deterministic **.NET 10** policy. It applies identically in Node and browser JavaScript. It does not depend on the host CPU width. Native `i`/`u` remain the runtime profile's 32-bit types.

ECMA-335 III.3.27 specifies truncation toward zero and integer narrowing; floating overflow and NaN results are unspecified. SharpForge chooses the .NET 10 results below for that unspecified behavior. Checked conversions continue to raise `OverflowException` when the truncated value cannot fit; they never use saturation. See [ECMA-335, Partition III, §§3.27–3.29](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf#page=378).

## Floating-point inputs

Let `trunc(x)` discard the fractional part toward zero. `S32(x)` is `trunc(x)` clamped to the Int32 range, with NaN mapped to zero.

| Opcode | Finite result | Negative infinity | Positive infinity | NaN |
| --- | --- | --- | --- | --- |
| `conv.i4`, `conv.i` | Clamp `trunc(x)` to −2³¹ … 2³¹−1 | −2147483648 | 2147483647 | 0 |
| `conv.u4`, `conv.u` | Clamp `trunc(x)` to 0 … 2³²−1 | 0 | 4294967295 | 0 |
| `conv.i8` | Clamp `trunc(x)` to −2⁶³ … 2⁶³−1 | −9223372036854775808 | 9223372036854775807 | 0 |
| `conv.u8` | Clamp `trunc(x)` to 0 … 2⁶⁴−1 | 0 | 18446744073709551615 | 0 |
| `conv.i1` | Low 8 bits of `S32(x)`, sign extended | 0 | −1 | 0 |
| `conv.u1` | Low 8 bits of `S32(x)`, zero extended | 0 | 255 | 0 |
| `conv.i2` | Low 16 bits of `S32(x)`, sign extended | 0 | −1 | 0 |
| `conv.u2` | Low 16 bits of `S32(x)`, zero extended | 0 | 65535 | 0 |

This gives `(long)1e30 = long.MaxValue` and `(ulong)(-1.0) = 0`. The smaller conversions intentionally use two steps: `(short)32768.0 = -32768` and `(sbyte)1e30 = -1`. The 32/64-bit behavior is documented in Microsoft's [.NET 9 floating-to-integer compatibility change](https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/9.0/fp-to-integer). The smaller conversions follow the .NET 10 JIT's [`fgMorphExpandCast` implementation](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/jit/morph.cpp#L293-L322). This is a pinned .NET 10 policy, including its smaller-integer behavior; it does not promise compatibility with other native versions or CPU-dependent historical results.

## Integer widening and stack representation

`conv.u8` interprets a 32-bit integer source as unsigned before widening. Consequently `0xffffffff` becomes 4294967295, while `conv.i8` sign extends that same pattern to −1. An existing 64-bit source retains all 64 bits. Checked `conv.ovf.u8` still treats the source as signed; `conv.ovf.u8.un` explicitly uses an unsigned source. These paths also appear in the [.NET 10 JIT opcode importer](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/jit/importer.cpp#L8204-L8277).

Unsigned **public values** in the table are distinct from signed **stack bit patterns**. For example, converting `3000000000.0` to `uint` stores `-1294967296` on the Int32 stack. A `uint` method result or `Console.WriteLine(uint)` presents `3000000000`; a subsequent `conv.u8` widens it to `3000000000n`. Likewise UInt64.MaxValue occupies the Int64 stack as `-1n`. This representation is intentional and is tested through output and host return values.

The pure helper represents CIL floating values with `float(value)` or `float(value, 'r4')`; ordinary VM Numbers carry 32-bit integer stack patterns and BigInts carry Int64 patterns. Direct helper callers may supply bare JavaScript Numbers outside the signed/unsigned 32-bit integer domain, including `1e30`, fractional values, infinities, and NaN; these take the floating conversion path. Bare `-1` and `4294967295` remain integer inputs. Tag an in-range floating value explicitly: `convert('conv.u8', float(-1))` yields zero, whereas `convert('conv.u8', -1)` yields `4294967295n`.

## Validation and supported scope

`tests/a05-numeric-conversions.test.js` covers the table, 32/64-bit boundaries, checked controls, unsigned output, host return values, and independent managed IL. `tests/a05-seams-numeric.test.js` covers the isolated numeric module and error adapters.

Run `node scripts/validate-a05-numeric-dotnet.js` with a .NET 10 SDK/runtime. It runs the exact conversion fixture on the native JIT and the direct CIL engine, and separately builds the C# reproducer in `tests/fixtures/a05/numeric-conversions`. The native conversion methods disallow inlining so constant folding cannot hide runtime conversion behavior. The script reports the runtime version, platform, architecture, and counts only after all comparisons pass; unavailable .NET 10 is an explicit failure, not a silent pass.

The source-debugging `VirtualMachine` delegates Int32 casts to the shared conversion helper; constant folding uses the same saturation policy so source execution, emitted IL, and compile-time values agree. Wider source arithmetic remains part of T01. Native 64-bit `nint`/`nuint`, other CLR versions, and CPU-specific historical overflow behavior are outside this profile. Pure JS and direct CIL coverage require no .NET installation; native parity requires running the reference script on each claimed host platform.

## Shared conversion policy increment (T01.6)

`@sharpforge/bytecode` exports `convert`, `conversionTargets`, `number` and
`isNumber`. Runtime numeric operations consume this same policy. The target
catalog is immutable and lists the 13 ECMA opcode suffixes; a native target is
one suffix, not a separate opcode per host width. The native target metadata describes the default 32-bit ABI; conversion calls
select precompiled 32-bit or 64-bit policies using `context.nativeIntBits`.
Native results retain their category in an immutable carrier; `number(value)`
reads the signed payload. See [native width](cil-native-width.md). Decimal
integration remains separate work.

Valid opcode policies are compiled once into a private lookup table. Integer
targets share frozen exact bounds and floating saturation thresholds; conversion
calls do not parse opcode names or reconstruct those bounds. This is a code-path
change without a measured throughput or allocation-rate claim.

Malformed opcode combinations such as `conv.r`, `conv.ovf.r4` and `conv.u4.un`
now reject with `CilError` instead of accidentally selecting a valid conversion.
The optional `error(message)` and `fault(name, message)` factories preserve
runtime diagnostics. Valid conversions retain the saturation and stack-bit
rules above. `tests/a05-conversion-policy.test.js` adds public policy, malformed
opcode, source-tag and injected-error regressions; existing independently
assembled numeric conversion tests cover guest execution. The serial slot passed
149 policy/conversion/numeric-seam/storage/value-ABI tests at `2f1a7769` on Node
24.21.0 (resource wrapper, 512MB, one test file/run). Syntax/import checks passed
with 1,858 syntax modules and no errors; the non-strict structure report retained
264 repository warnings. Full T01.6 native-oracle, source/reloaded and platform
qualification remains pending.
