# Int32 signed remainder overflow

For runtime operands, `Int32.MinValue % -1` now raises `OverflowException`, as
`Int32.MinValue / -1` already did. The source interpreter delegates integer
division and remainder to the existing CIL numeric helper, so source execution,
source reloaded from emitted IL and direct CIL share this guard. The previous
remainder implementation returned zero.

This is the pinned .NET policy, not an assertion that every CLI must throw:
[ECMA-335, Partition III §3.55](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf#page=407)
permits `ArithmeticException` for the minimum signed integer with divisor −1.
Microsoft's [OpCodes.Rem documentation](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.opcodes.rem?view=net-10.0)
documents `OverflowException` on Intel platforms. The
[.NET 10 ARM64 JIT](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/jit/codegenarm64.cpp#L3185-L3265)
lowers integer remainder through division and emits the signed division overflow
check. The saved native oracle also observes `OverflowException` on macOS arm64.

`tests/fixtures/a05/int32-remainder/native-boundaries.json` selects ten unchanged
rows from the existing .NET 10.0.5 / SDK 10.0.201 oracle at commit `a466e3ca`.
Its provenance records both original SHA-256 hashes and each source output line.
Lines 555 and 556 of `uint32-matrix.txt` record division and remainder of
−2147483648 by −1; both report `!OverflowException`. This slice did not run .NET
or generate replacement oracle results.

The guard applies in checked and unchecked runtime expressions. Unsigned
remainder, neighboring signed values, divide-by-zero handling and floating-point
remainder retain their existing behavior. Constant-expression folding is a
separate compiler contract and is unchanged; regressions use method parameters
to exercise the runtime instruction.

`tests/a05-int32-remainder.test.js` includes pure-helper cases, independently
assembled CIL methods, source/reload/emitted-CIL regressions, injected fault
identity and floating signed-zero controls. Serial validation at `f6f58480` passed all 38 tests across this file,
`a05-seams-numeric.test.js` and `a05-seams-source.test.js` under Node 24.21.0,
with one test worker and a 512 MB heap cap. The required core check handles
static/manifests and build validation. Native/browser qualification and
performance measurement remain queued; no throughput claim or full T01
completion is implied.
