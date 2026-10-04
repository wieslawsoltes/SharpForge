# Native numeric oracle

This directory preserves the native oracle from the authored A05 numeric work:
.NET SDK 10.0.201, CoreCLR 10.0.5 on macOS ARM64, with a 64-bit native integer ABI.
`provenance.json` records the historical generator revision and SHA-256 hashes.
Replaying these files validates current VM results against those native answers;
it does not claim a new native run or qualify another architecture.

`node scripts/numeric/generate-oracle.js <output-directory>` regenerates answers
with a real .NET 10 SDK. Use an artifact directory to preserve historical evidence.
Missing, oversized or corrupted fixtures fail the differential test. JavaScript
results are never substituted for native answers.

The committed artifacts must include `int64.txt.gz` (100,000 deterministic operand
pairs, 29 operations per pair), family source/output files, a five-source-kind
conversion matrix, the six-location small-storage results, and `provenance.json`.
The provenance records SHA-256 hashes, actual .NET 10 SDK/runtime, architecture,
ABI width, source commit, invariant globalization and per-family language version.
The Int64 text table is compressed only for repository size; it contains every
individual result or managed fault, rather than a digest of aggregate results.

ECMA defines 13 conversion target encodings. Instantiating native i/u at both ABI
widths gives 15 concrete target columns. The native generator qualifies its actual
process width. The other width remains explicitly unqualified until generated on
that CLR target; existing configured-ABI tests exercise both VM widths meanwhile.
NaN classification and signed zero are observed; arbitrary NaN payload preservation
through arithmetic is outside the scalar contract.

The fixture consumer runs source, source reloaded from an emitted DLL, and direct
CIL against the checked native answers. Output is compared after bounded execution
slices and drained to avoid retaining three million-row output arrays. Total output
and instruction quotas remain enforced. Failures identify the engine and output
row; conversion cases additionally include the original source/target/operand.
The storage fixture generator invokes the
same authored DLL through native reflection, including argument and byref stores.
Rust native/Wasm execution remains unqualified: this repository currently has no
such execution engine adapter. Browser execution of these shared helpers requires
the assembled browser gate and does not count as a native CLR qualification.
