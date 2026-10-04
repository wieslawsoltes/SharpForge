# Reviewed WinUI measurement baselines

`winui-measure/run.js` captures 20 XAML fixtures three times on Windows x64.
`winui-expected.js` adopts or compares an explicitly reviewed, retained capture;
it never executes the report's commands. The complete set is one atomic
`winui-measurements` entry. Existing WinUI smoke baselines keep their own identity.

Before adoption, review the capture's native process output, source commit,
locked restore/build, toolchain and Windows image provenance, binary hashes and
all three complete attempts. Retain the original report and its independently
computed SHA-256 with the adoption receipt. Do not place these provenance reports
in the expected store, whose JSON files are exclusively baseline envelopes.

```sh
node scripts/conformance/oracle/winui-expected.js adopt \
  --capture /path/to/reviewed-winui-capture.json \
  --reviewed-commit FULL_CAPTURE_COMMIT \
  --reviewed-sha256 REVIEWED_REPORT_SHA256
```

Adoption checks the review digest and clean source commit before any store write.
It requires exactly 20 current fixtures, exact host/XAML/catalog/runtime-project/
lockfile input hashes, pinned compiler/runtime/reference identities, a supported
Windows target and complete successful restore/build and three measurement
processes. Raw output must agree with each parsed dump; all three dumps must
agree. Failed, dirty, incomplete or unsupported captures are rejected.

DPI, layout slots, desired/actual sizes, property values/local-value flags,
automation peer trees and signed negative HRESULTs are retained exactly. Native
`NaN`/`Infinity`/`-Infinity` encodings remain strings. There is no layout tolerance,
DPI scaling, property filtering or synthetic automation fallback. A changed
native input invalidates the old entry; a different stable measurement fails
comparison. The schema and bounded tree validator reject incomplete result shapes.

The baseline path follows the existing oracle/version/target/input-hash key.
Adoption uses exclusive file creation and refuses overwriting even an identical
baseline. Use comparison for an existing key:

```sh
node scripts/conformance/oracle/winui-expected.js verify \
  --capture /path/to/reviewed-winui-capture.json \
  --reviewed-commit FULL_CAPTURE_COMMIT \
  --reviewed-sha256 REVIEWED_REPORT_SHA256
node scripts/conformance/oracle/verify-expected.js
```

An optional `--store DIRECTORY` selects an isolated store for either operation.
Both operations emit a receipt binding the reviewed report digest, source commit,
capture time, target, actual toolchain/environment, executable hashes and input
identity. Keep it with the original capture. A local Windows capture explicitly
retains `pinnedImage: false`; hosted captures must match the pinned Windows image.
The report and receipt are provenance records, not remote execution attestation.

No new baseline values are supplied by this implementation. Synthetic Node test
fixtures exercise validation and filesystem behavior only. Adoption and
comparison do not establish SharpForge parity, performance or another platform's
qualification, and do not extend the historical 58-record harness evidence.
