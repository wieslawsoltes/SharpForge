# Scalar values in synthesized members

Project #7's scalar modes now flow through existing tuple, record and indexer
lowering. Typed read/modify/write operations use promoted arithmetic followed by
the destination conversion, including checked narrowing. They preserve receiver
and index evaluation order, prefix/postfix values, and immutable tuple copies.

The shared structural member generator formats every scalar mode with its declared
type. UInt32 and UInt64 retain unsigned text; Decimal retains scale; Single uses
Single formatting. Synthesized equality follows Single/Double `Equals` NaN behavior,
while tuple equality operators retain IEEE comparison behavior. Existing wide tuple
`Rest` access and updates continue to use the current compiler implementation.

## Validation

The new regression file is `tests/a05-scalar-structural-members.test.js`. Each
execution case runs source bytecode, source reloaded from emitted PE, and direct CIL.
The initial unmodified baseline failed all six cases. A combined serial run with
the existing scalar, short tuple, and wide tuple suites passed **56 tests** on
Node 24.19.0, Linux x64. The synthetic equality case exercises the existing record
member generator; direct `ValueTuple.Equals(object)` remains outside that compiler
profile and is not claimed as newly implemented.

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_TEST_CONCURRENCY=1 \
SHARPFORGE_MAX_OLD_SPACE_MB=512 node scripts/limited.js node --test \
  --test-concurrency=1 tests/a05-scalar-structural-members.test.js \
  tests/a05-source-numeric-modes.test.js tests/compiler-tuples.test.js \
  tests/compiler-tuples-wide.test.js
```

This is a compiler integration correction for A05's runtime value modes. No
performance improvement, native CLR execution, browser run, or other platform
qualification is inferred from this result.
