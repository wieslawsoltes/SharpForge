# Numeric verifier qualification

This complete numeric policy batch is implementation-ready. Serial native,
focused, browser, performance and static qualification is pending the root slot.
No ordinary PR core result is unit/native/browser qualification evidence.

`input.js` independently authors the ECMA operand/storage/control-flow corpus.
`capture.mjs` runs pinned ILVerify 10.0.5 / SDK 10.0.201 / CoreCLR 10.0.5 against
each emitted image and retains every actual observation before asserting the
predeclared expected oracle results. Product and native acceptance are separate.
See `packages/cil/VERIFIER-NUMERIC.md` for source-backed differences.

`baseline.mjs` demonstrates the missing typed API on the parent while retaining
the existing height verifier's acceptance of int32 + float. It is evidence of an
added verifier capability, not a claim that the execution-height API changed.

Commands (run sequentially through the machine limiter):

```sh
node tests/fixtures/verifier-numeric/capture.mjs tests/fixtures/verifier-numeric/native.json
node --test --test-concurrency=1 tests/a03-numeric-transfers.test.js tests/a03-verifier-dataflow.test.js tests/a03-verification-types.test.js
node packages/cil/tools/benchmark-handler-entry.mjs <existing-control.json>
node packages/cil/tools/benchmark-numeric-verifier.mjs <new-capability.json>
npm run check
npm run check:structure
```

The fixed performance plan retains 12 chronological samples for each of three
existing height controls on parent/candidate, and 12 for each of three added typed
workloads. The first three are warmup; median/p95 use all remaining samples.
Heap deltas are observations rather than peak-memory or allocation counts.
