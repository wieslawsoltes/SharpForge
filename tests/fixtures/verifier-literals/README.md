# String-literal verifier corpus

`input.js` reuses the ordinary-CLI `managedFixture` builder and the existing field
authority contract. `cases.js` declares positive, negative and unsupported cases
before native execution. Inputs cover UTF-16/surrogates, compressed-length
boundaries, primitive storage, reference joins and field/literal composition.
The Node mixed-field checks replay canonical CoreLib facts captured in
`a03-type-categories/native.json`; the browser replay supplies explicit synthetic
canonical identities. Product code never classifies a type by its name.

`capture.mjs` reuses `captureVerifierCases`, pinned to SDK 10.0.201, CoreCLR 10.0.5
and ILVerify 10.0.5. It saves every input/image hash, raw stdout/stderr/exit and
tool identity before parsing or asserting the result. `NominalReturnUnknown`
deliberately remains a product unknown despite the native rejection expectation.
Malformed heap marker/truncation tests are structural policy tests, separate
from the well-formed native transfer corpus; no unobserved native outcome is
claimed for those malformed inputs.

Qualification is pending the root-owned serial slot. The native replay test is
strict and needs a real `native.json`; no placeholder observations or skips exist.
Capture to scratch first, preserve failed attempts, inspect the complete result,
then retain the successful capture before running replay:

```sh
node scripts/limited.js node tests/fixtures/verifier-literals/capture.mjs /tmp/literal-native.json
node scripts/limited.js node --test \
  tests/a03-string-transfers.test.js tests/a03-string-metadata.test.js \
  tests/a03-string-budgets.test.js tests/a03-string-native.test.js
```

Affected controls include `tests/a03-field-transfers.test.js`,
`tests/a03-numeric-transfers.test.js`, `tests/a03-typed-preparation.test.js`,
`tests/a03-05-il-document-strings.test.js` and existing inspector-view coverage.
Chromium/Firefox/WebKit can invoke exported `run()` from `browser.mjs` through
the existing source-module harness. Source VM, direct-CIL and Rust/native/Wasm
execution-engine qualification is not claimed by this non-executing API.

The benchmark schedule uses unchanged `benchmark-numeric-verifier.mjs` and
`benchmark-field-verifier.mjs` in both complete baseline and candidate worktrees
for the existing controls. New literal cost uses this candidate-only command:

```sh
node scripts/limited.js node packages/cil/tools/benchmark-literal-verifier.mjs /tmp/literal-performance.json
```

All drivers retain twelve chronological samples and heap deltas per workload,
with the first three designated warmups and median/p95 from the remaining nine.
The new driver measures short and long literals, repeated-token loads and a
mixed String-field store. These are added-capability costs; an old `unknown`
result is never used as a faster baseline. Heap deltas are not allocation counts
or peak memory. Record runtime/machine, source revisions and shared-host status,
retain every sample and report any measured >5% existing-control regression.

Baseline regression should run the `StringReturn` fixture against the
pre-literal commit's own CIL source and require `verified`; its old unknown result
is the expected failure. Do not overwrite candidate files or substitute its
package imports into the baseline. No baseline or performance result has been
recorded by this implementation batch.
