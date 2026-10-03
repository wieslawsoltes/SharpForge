# Direct-CIL IEEE bit observations (T01.5 / #1348, partial)

Verified direct-CIL calls now support four exact `System.BitConverter` signatures:

| Method | Parameter | Result |
| --- | --- | --- |
| `SingleToInt32Bits` | `float` | `int` |
| `DoubleToInt64Bits` | `double` | `long` |
| `Int32BitsToSingle` | `int` | `float` |
| `Int64BitsToDouble` | `long` | `double` |

These reinterpret the stored IEEE bits; they do not perform integer/floating
numeric conversions. The inverse adapters return the existing immutable R4/R8
stack carriers. The [Single observer](https://learn.microsoft.com/en-us/dotnet/api/system.bitconverter.singletoint32bits?view=net-10.0)
and [Double inverse](https://learn.microsoft.com/en-us/dotnet/api/system.bitconverter.int64bitstodouble?view=net-10.0)
contracts come from the .NET API. The shared verifier/runtime registry rejects
wrong parameter widths, return types, arity and instance forms.

The implementation reuses the assembled E01 DataView algorithm in a standalone
bytecode helper, with one private synchronous scratch view rather than a fresh
ArrayBuffer per call. No performance improvement is claimed without measurement.
There are no new VM fields, snapshots, value carriers or source frontend hooks.

`tests/a05-bit-converter.test.js` covers both directions, signed zero, finite
endpoints, subnormals, infinity, NaN classification, managed storage and invalid
signatures. It also replays six IEEE observations from the original saved
.NET 10.0.5 / SDK 10.0.201 osx-arm64 oracle. The fixture retains exact original
source/output text and SHA-256 hashes; no native outputs were generated here.

Source C# API binding, source-image reload and Rust/Wasm qualification remain
open. Arbitrary NaN payload and signaling-NaN preservation through JavaScript
floating operations are not claimed. This increment does not close #1348 or
T01's cross-engine differential acceptance.

Serial validation at `62363720` passed all 41 tests under Node 24.21.0,
one worker and a 512 MB heap cap. This revision includes the landed native-width
adapters. Static/manifests and build validation use the required core check;
benchmarks and broader qualification remain staged. The focused run included `tests/a05-bit-converter.test.js`,
`tests/a05-float-precision.test.js`, `tests/a05-seams-cil-intrinsics.test.js` and
`tests/a00-01-value-abi.test.js` via `node scripts/limited.js node --test ...`.
