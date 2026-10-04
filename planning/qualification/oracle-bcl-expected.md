# BCL native capture adoption

`bcl-run.js` captures 200 catalogued cases in the invariant and `fr-FR` cultures. A successful capture is a receipt, not an adopted or qualified baseline. The separate expected-store command reads that receipt without starting a compiler, runtime, or capture command:

```sh
node scripts/conformance/oracle/bcl-expected.js --adopt /path/to/native-capture.json
node scripts/conformance/oracle/bcl-expected.js --verify /path/to/fresh-native-capture.json
node scripts/conformance/oracle/verify-expected.js
```

Use `--store DIRECTORY` after the report path to select a separate store. Adoption is explicit and creates ten records: one native process result for each family/culture pair. It preserves the receipt's target, stdout bytes, stderr, exit status, signal and unhandled exception. The existing oracle/version/target/input-hash key and expected schema remain unchanged. The input hash binds the combined common/family C# source, catalog, compiler options and culture.

Both commands require all five current families, all 200 cases in both cultures, a clean source revision receipt, current source/catalog/input hashes, the exact pin manifest, matching resolved SDK/runtime/compiler/reference hashes for the recorded target, and recognized image provenance. They require the runner's two compilation/execution timing records, successful native process results, and observation metadata equal to the raw stdout parsed against the current catalog. Local OS evidence remains explicitly unpinned; imported receipts retain their source commit and capture hash in the command summary. Receipt checks do not authenticate a report or independently repeat native execution. The capture runner establishes repeat equality before emitting its successful receipt.

Adoption validates the whole receipt and checks every existing target key before writing. An identical record is retained; a conflicting record fails and is never overwritten. File creation is exclusive, including after a concurrent writer. An I/O failure can leave a valid subset of newly created records; rerunning the same receipt safely completes missing records. No command deletes stale baselines. Retiring a baseline after an input change requires a separately reviewed store change.

Verification compares all ten expected records against the supplied complete capture and fails for missing or different output. `verify-expected.js` also resolves BCL records already in the store and rejects stale inputs or malformed/incomplete observations. It does not assert that every native target has been captured. Adoption reports `adopted-not-qualified`; matching a fresh reference capture reports `matched-reference-baselines`. Neither status establishes SharpForge runtime parity or hosted runner qualification. Keep the native capture artifact and review the resulting JSON diff before accepting reference data.

The ingestion tests use explicitly synthetic process rows in temporary stores. They are not reference outputs, and no native baseline data accompanies this implementation.
