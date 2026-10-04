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

## Recorded qualification

The coordinating serial run used product revision
`6aae05c05d935ae0b90de67ec9a1840fa32ac29d`, preserving the original PR #4519
revision `52d21294048ed81e6bd8f14120a365f4acdca8c4` in its ancestry. Node was
24.19.0 on Linux x64, kernel 6.18.44. This is a recorded local environment,
not an immutable runner-image claim.

| Evidence | Recorded outcome |
|---|---|
| [Native capture](native.json) and [capture log](qualification/native-capture.log) | 31/31 predeclared native expectations matched; 23 accepted and 8 rejected |
| [Focused Node log](qualification/focused-node.tap) | 57 passed, 0 failed, 0 cancelled, 0 skipped |
| [Inspector-method view log](qualification/inspector-method-view.tap) | Separate run: 4 passed, 0 failed, 0 cancelled, 0 skipped |
| [Chromium launch attempts](qualification/summary.json) | Both failed during startup; zero product checks |
| Firefox / WebKit | Not run |
| Performance measurements and final publication gate | Pending the coordinating serial slot |

The native capture records exact pinned tool and reference hashes, assembly/source
hashes, raw output and exit status. Of its 31 observations, 30 agree with a
determinate product result: 23 verified and 7 rejected. `NominalReturnUnknown`
remains the one unsupported product relation while ILVerify rejects it. That
unknown is not reported as policy agreement. The focused Node run includes strict
native replay and the malformed #US, Unicode, budget, cancellation and mixed-field
checks, plus existing numeric, field, indirect-memory and IL-document controls.

[qualification/summary.json](qualification/summary.json) records the exact SHA-256
and original location of every retained log. Node and capture logs were copied
byte-for-byte; browser output is preserved as exact UTF-8 text in JSON envelopes
with the raw byte hashes. The 31-observation `native.json` was retained unchanged.
The Node logs have result
records but no command headers, so the commands below are reproducible replays,
not reconstructed original invocation records. No test or capture was rerun while
preparing this documentation/evidence commit.

## Reproduce native capture and Node replay

The native replay test is strict and requires the actual `native.json`; no
placeholder observations or skipped-pass fallback exists. For a future capture,
write to scratch first, retain any failed attempt, inspect the complete result,
and replace the committed capture only with the actual validated observation:

```sh
node scripts/limited.js node tests/fixtures/verifier-literals/capture.mjs /tmp/literal-native.json
node scripts/limited.js node --test \
  tests/a03-05-il-document-strings.test.js tests/a03-field-transfers.test.js \
  tests/a03-indirect-transfers.test.js tests/a03-numeric-transfers.test.js \
  tests/a03-string-transfers.test.js tests/a03-string-metadata.test.js \
  tests/a03-string-budgets.test.js tests/a03-string-native.test.js \
  tests/a03-typed-preparation.test.js
node scripts/limited.js node --test tests/a03-inspector-method-view.test.js
```

## Browser qualification remains incomplete

Chromium failed before importing `browser.mjs` or invoking `run()` in both
retained attempts. The first failed with a spawn `EACCES`
([report](qualification/browser-permission.json), [raw output](qualification/browser-permission.log.json)).
The second launched but aborted with `SIGABRT` after its ProcessSingleton socket
operation returned `Operation not permitted`
([report](qualification/browser-launch.json), [raw output](qualification/browser-launch.log.json)).
These are host startup failures, with zero product checks and no browser pass.
The reports record Playwright 1.62.0 and the browser-module source hash.

The exact [browser driver](qualification/browser-driver.py.txt) is retained as
evidence. It serves public source modules using an import map and CSP and invokes
the exported `run()` only after a successful launch. Firefox and WebKit were not
run after Chromium aborted the harness. All three engines still need successful
qualification. Source-VM, direct-CIL and Rust/native/Wasm execution-engine
qualification is not claimed by this non-executing typed API.

## Performance measurements remain pending

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
recorded in the retained literal evidence. The coordinating agent owns the pending
measurements and final publication gate. Full object-model and constructor/EH
work remains open under #2403/#2405/#52; this literal batch does not close them.
