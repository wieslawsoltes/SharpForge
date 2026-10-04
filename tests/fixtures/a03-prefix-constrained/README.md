# Type-prefix reference plan

Nine independently authored ordinary CIL methods cover constrained/readonly
positives, invalid targets, duplicates, a missing type row and two deliberate
partial-scope cases: a readonly pointer store and the array Address method.
The capture must retain actual ILVerify decisions, including disagreements; it
does not claim full pointer/call verification or run these method bodies.

Captured with the repository's pinned ILVerify 10.0.5 tools, SDK 10.0.201 and
reference pack 10.0.5. Reproduce during an exclusive serial slot:

```sh
node scripts/limited.js node tests/fixtures/a03-prefix-constrained/capture.mjs /tmp/a03-prefix-types-native.json
```

Set SHARPFORGE_ILASM, SHARPFORGE_ILVERIFY and SHARPFORGE_ORACLE_DOTNET as documented
in tests/conformance/verifier/README.md. The shared tool checker verifies ILAsm
bytes, but fixtures are emitted by the existing independent managed fixture builder.
The bounded process runner and single-method parser are reused. Capture records
raw outputs, tool/source/image hashes and candidate diagnostics without asserting
that every oracle decision matches this explicitly partial service.

`native.json` records seven agreeing lexical/type-token cases, plus two deliberate
differences. ReadonlyStore is rejected by ILVerify (`ReadOnlyIllegalWrite`) but
accepted by the lexical pass; ArrayAddress is accepted by ILVerify but receives
`CILPC0006` here. These results do not establish typed pointer/call verification.

`performance.json` retains seven chronological samples after two warmups for
1,000/5,000 groups, comparing existing grouping with the new opt-in validation.
Run `node scripts/limited.js node --expose-gc packages/cil/tools/benchmark-prefix-constrained.mjs /tmp/prefix-types-performance.json`.
The measurement used Node 24.21.0, macOS arm64, Apple M3 Pro, as the sole scheduled
team validation job on a shared host. Sampled heap deltas are not allocation or
RSS measurements. No speedup or statistical significance is claimed.

The retained capture above predates array Address recognition. Current capture
input expects ArrayAddress to pass; the follow-up capture and scope are in
`../a03-prefix-array-address`. The original raw native observation is unchanged.
