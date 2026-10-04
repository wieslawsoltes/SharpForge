# Memory-prefix reference observations

`input.js` emits eight ordinary CIL methods through the existing independent
managed fixture builder. Four use permitted volatile/unaligned targets and both
orders. Two use forbidden targets. One repeats volatile and one uses no. on an
array read. The last two distinguish the requested strict policy and verifiability
from runtime tolerance or support; oracle agreement is not assumed in advance.

Capture is prepared, not run. It reuses repository ILVerify 10.0.5 tool hash checks,
pinned SDK 10.0.201/reference pack 10.0.5, bounded process execution and the existing
single-method result parser. IL is inspected, not executed. Each result retains
raw output, native diagnostics and the candidate result. It does not run the full
177-case verifier corpus or claim ILVerify implements ECMA's no. prefix.

At the exclusive validation slot, provision the existing pinned tools and run:

```sh
node scripts/limited.js node tests/fixtures/a03-prefix-memory/capture.mjs /tmp/a03-prefix-memory-native.json
```

Set `SHARPFORGE_ILASM`, `SHARPFORGE_ILVERIFY` and, when necessary,
`SHARPFORGE_ORACLE_DOTNET` as described in tests/conformance/verifier/README.md.
The shared prerequisite checker verifies ILAsm bytes but this capture uses the
SharpForge fixture writer, not ILAsm. No automatic downloads/installations occur.
After inspecting the capture, retain its actual observations; do not infer
acceptance from a missing native run.
