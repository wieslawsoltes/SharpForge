# Type-prefix reference plan

Nine independently authored ordinary CIL methods cover constrained/readonly
positives, invalid targets, duplicates, a missing type row and two deliberate
partial-scope cases: a readonly pointer store and the array Address method.
The capture must retain actual ILVerify decisions, including disagreements; it
does not claim full pointer/call verification or run these method bodies.

Prepared, not run. At the exclusive serial slot, use the repository's existing
pinned ILVerify 10.0.5 tools, SDK 10.0.201 and reference pack 10.0.5:

```sh
node scripts/limited.js node tests/fixtures/a03-prefix-constrained/capture.mjs /tmp/a03-prefix-types-native.json
```

Set SHARPFORGE_ILASM, SHARPFORGE_ILVERIFY and SHARPFORGE_ORACLE_DOTNET as documented
in tests/conformance/verifier/README.md. The shared tool checker verifies ILAsm
bytes, but fixtures are emitted by the existing independent managed fixture builder.
The bounded process runner and single-method parser are reused. Capture records
raw outputs, tool/source/image hashes and candidate diagnostics without asserting
that every oracle decision matches this explicitly partial service.
