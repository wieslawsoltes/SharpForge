# Memory-prefix reference observations

`input.js` emits eight ordinary CIL methods through the existing independent
managed fixture builder. Four use permitted volatile/unaligned targets and both
orders. Two use forbidden targets. One repeats volatile and one uses no. on an
array read. The last two distinguish the requested strict policy and verifiability
from runtime tolerance or support; oracle agreement is not assumed in advance.

The committed native.json captures eight decisions with repository ILVerify 10.0.5 tool hash checks,
pinned SDK 10.0.201/reference pack 10.0.5, bounded process execution and the existing
single-method result parser. IL is inspected, not executed. Each result retains
raw output, native diagnostics and the candidate result. It does not run the full
177-case verifier corpus or claim ILVerify implements ECMA's no. prefix.

At the exclusive validation slot, reproduce with the existing pinned tools:

```sh
node scripts/limited.js node tests/fixtures/a03-prefix-memory/capture.mjs /tmp/a03-prefix-memory-native.json
```

Set `SHARPFORGE_ILASM`, `SHARPFORGE_ILVERIFY` and, when necessary,
`SHARPFORGE_ORACLE_DOTNET` as described in tests/conformance/verifier/README.md.
The shared prerequisite checker verifies ILAsm bytes but this capture uses the
SharpForge fixture writer, not ILAsm. No automatic downloads/installations occur.
The four permitted chains are accepted. Wrong targets report Volatile/Unaligned,
repeated volatile reports Volatile, and no. reports Unverifiable. All eight agree
with the candidate's default decision; diagnostic IDs intentionally differ.
The separate prefix-groups native fixture demonstrates that CoreCLR execution can
tolerate a duplicate rejected by ILVerify and this validator. No. is only accepted
by the candidate with explicit correctness-only mode, not as verifiable IL.
