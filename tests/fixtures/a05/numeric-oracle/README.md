# Native numeric oracle

This directory is populated by `node scripts/numeric/generate-oracle.js` only after
all E01 implementation work is assembled. The generator has not been executed in
the implementation-only phase. Missing oracle/provenance files are a hard failure
in `tests/numeric-differential.test.js`; the test never substitutes JS results.

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
CIL against the checked native answers. The storage fixture generator invokes the
same authored DLL through native reflection, including argument and byref stores.
Rust native/Wasm execution remains unqualified: this repository currently has no
such execution engine adapter. Browser execution of these shared helpers requires
the assembled browser gate and does not count as a native CLR qualification.
