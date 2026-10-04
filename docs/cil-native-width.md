# Direct-CIL native integers (T01.4 / #1347, partial)

`new CilVirtualMachine(bytes, {nativeIntBits: 32 | 64})` selects the native
integer ABI before metadata layout, initialized storage or host arguments are
created. The default is explicitly **32 bits**, including on a 64-bit host.
The option is immutable for that VM; snapshots retain it as host configuration.

This batch implements the direct-CIL numeric path end to end:

- `conv.i/u`, checked variants including `.un`, and conversions from native
  integers to fixed-width integers or floating-point values.
- Mixed native/Int32 arithmetic and comparisons, checked overflow, bitwise
  operations, and native shift counts with the left operand's result category.
- Native locals, parameters, returns, fields, static fields, managed addresses,
  `ldind.i`/`stind.i`, native arrays and `ldelem.i`/`stelem.i`. Array indexes and
  lengths accept exactly representable native integers; heap limits still apply.
- `IntPtr.Size`, `UIntPtr.Size`, and `sizeof(IntPtr/UIntPtr)` report the configured
  width. Existing method tables carry the same identity and native value size.
- Exact host integer/decimal-string inputs, signed and unsigned results, boxed
  formatting and snapshot replay. Opaque method pointers remain opaque.

`nativeInteger(value, bits)` returns a frozen `{nativeInt: bits, value}` record.
Its payload is a signed Number at 32 bits or signed BigInt at 64 bits. This keeps
native integers distinct from Int32 and Int64 during mixed arithmetic. `number`
unwraps the payload. Host `nuint` results and declared formatting reinterpret its
unsigned bit pattern. Both `conv.i` and `conv.u` therefore now return a tagged
value even at the default width. Existing conversion tests unwrap it to retain
their numeric assertions; new tests assert the category separately.

The conversion opcode map and all integer/saturation bounds are compiled once
for each ABI. No opcode regex parsing or bound construction occurs per
conversion. The ordinary Int32 arithmetic path keeps its existing evaluator.
No throughput or allocation improvement is claimed; measurements are pending.

## Semantics and evidence

[ECMA-335 III.1.5, tables III.2–III.9](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf#page=328)
defines native stack categories, mixed operand combinations, conversions and
implicit argument coercion. The fixed-width conversion policy's pinned .NET 10
floating saturation behavior also applies at the selected native width.

The [.NET 10 CoreCLR importer](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/jit/importer.cpp#L5108-L5134)
widens mixed Int32/native64 arithmetic operands according to the opcode's
unsigned flag. Its [comparison and branch paths](https://github.com/dotnet/runtime/blob/v10.0.0/src/coreclr/jit/importer.cpp#L7222-L7333)
differ: comparison instructions sign-extend first, while unsigned conditional
branches zero-extend. The runtime preserves that distinction. These are primary
source references, **not newly executed native oracle results**.

## Qualification and remaining acceptance

Prepared tests are `tests/a05-native-width.test.js` and
`tests/a05-native-width-cil.test.js`. The latter assembles CLI fixtures directly,
independent of the C# compiler and source-image loader. They cover both widths,
endpoints, overflow, aliases, storage, host boundaries and snapshots. Updated
conversion/seam tests retain the old default numeric values through `number`.
Serial validation at `2dc0e6c1` passed all 226 tests across the ten focused
suites listed below (including delegate targets), using Node 24.21.0, one
worker and a 512 MB heap cap. The initial run passed 223/226; three legacy
assertions were updated to check the native width tag and exact payload instead
of a plain Number. Fixed-width and overflow assertions were retained. Required
core handles static/manifests and build checks. Benchmarks and new native
reference runs remain staged. After integrating main's framework method-table
helper, all 50 native-width, type-table and ABI regressions passed at
`15246751`; the conflict resolution retained both imports and their behavior.

Source C# `nint/nuint` binding/emission and source-image reload support remain
open, as do Rust/Wasm and native 32/64 reference qualification. Generic/reference
`sizeof`, unmanaged pointers, decimal integration and broader `IntPtr` APIs are
outside this increment. #1347 stays open until its remaining targets and evidence
are complete. The ABI inventory describes an internal JS carrier, not a change
to the portable value-codec wire protocol.

The coordinator's serial validation slot should run the two prepared suites,
`tests/a05-conversion-policy.test.js`, `tests/a05-numeric-conversions.test.js`,
`tests/a05-seams-numeric.test.js`, `tests/a05-seams-snapshot.test.js`, existing
small-storage/type-table tests and `tests/a00-01-value-abi.test.js`, through
`node scripts/limited.js node --test ...` with one test file at a time.
