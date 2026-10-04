# A05 browser qualification

The focused [workflow](../.github/workflows/a05-browser.yml) runs Chromium, Firefox,
and WebKit serially on `ubuntu-latest`. It is authorized by an `SF-A05` PR title
plus the `full-ci` label, or by manual dispatch. It has read-only repository
permissions, a 25-minute bound per engine, and always uploads results, including
dependency/setup failures. It does not infer browser results on Windows/macOS or
replace the separate Studio browser matrix and native CLR qualification.

No browser result is established merely by adding this workflow. Acceptance
requires completed `report.json` case rows from the exact tested revision. The
Node fixture tests and Python evidence-validator tests are useful regressions but
cannot establish actual browser, CSP, or Speedscope UI behavior.

## Cases and evidence

| Case | Actual observation required |
| --- | --- |
| `wasm-execution` | A real prepared CIL method instantiates in browser WebAssembly and uses native arithmetic. Its output, full instruction profile, and instruction count equal interpreted CIL; a zero-time slice executes nothing. |
| `debugger-deopt` | A hot loop enters Wasm through OSR, a real `CilDebugSession` instruction breakpoint deoptimizes it, and single stepping exposes the expected PC, locals, and operand stack. Resume uses canonical arithmetic and cannot silently select Wasm again. |
| `profile-exports` | Source, reloaded source image, and CIL guest programs execute and export actual recorded instruction profiles. The profile files and exact VM method counts are retained. |
| `csp-denied-fallback` | A separate real HTTP document omits `wasm-unsafe-eval`. Actual compilation fails with `WASM_COMPILE`, the browser emits an enforced CSP violation, and automatic tiering records fallback while interpreted execution produces the correct result. |
| `speedscope-source`, `speedscope-reload`, `speedscope-cil` | The official UI imports each generated file through its real file input. Its visible Sandwich table must contain every recorded method with the exact displayed Total and Self counts; the sum of displayed Self counts must equal actual VM instructions. |

The runtime documents use the shipped `createBrowserCsp()` value with one added
hash for the fixture import map. The denial document removes only
`wasm-unsafe-eval`. Modules resolve through public package entry points. These
pages exercise the runtime under HTTP CSP; they do not imply a Studio UI result.
The official offline Speedscope assets use a separate local HTTP origin and do
not stand in for the product's CSP. External requests are blocked and fail the
case. No guest profile is uploaded to a third-party service.

The shared browser launcher rejects unexpected CSP events. Only the dedicated
denial case accepts its expected negative launch result, after validating the
document URI, enforced script directive, and `wasm-eval`/`eval` blocked URI.
Its retained launcher `session.json` therefore records the expected CSP rejection;
the qualification row records whether that negative requirement was satisfied.

## Official Speedscope pin

The runner uses the self-contained asset from the official
[v1.24.0 release](https://github.com/jlfwong/speedscope/releases/tag/v1.24.0):

- Commit: `fc76932551754a442cd5c4f0afdba28032d14d8a`.
- Asset: `speedscope-1.24.0.zip`, 218392 bytes.
- SHA-256: `1cd7de1f33e7a56a0b08ca51b4ba9598b766676f9c5f07077e731258d47e6121`.
- Digest source: the official GitHub release asset metadata. Preparation rejects
  any different bytes and records every extracted file's hash.

UI assertions were reviewed against this pinned version's official
[`application.tsx`](https://github.com/jlfwong/speedscope/blob/fc76932551754a442cd5c4f0afdba28032d14d8a/src/views/application.tsx),
[`profile-table-view.tsx`](https://github.com/jlfwong/speedscope/blob/fc76932551754a442cd5c4f0afdba28032d14d8a/src/views/profile-table-view.tsx), and
[`value-formatters.ts`](https://github.com/jlfwong/speedscope/blob/fc76932551754a442cd5c4f0afdba28032d14d8a/src/lib/value-formatters.ts).
The runner uses `#file`, the documented application shortcut `3`, and the rendered
table's three cells. It does not inject profile state or call Speedscope's parser
directly. A future UI change requires deliberate pin and assertion review.

## Running and interpreting results

Use the existing pinned development dependencies; no runtime dependency is added:

```sh
npm ci --ignore-scripts --no-audit --no-fund
python -m pip install --require-hashes --only-binary=:all: -r tests/requirements.txt
python tests/fixtures/a05-browser/qualify.py --prepare
python -m playwright install --with-deps chromium
python tests/fixtures/a05-browser/qualify.py --engine chromium
```

Repeat serially for `firefox` and `webkit`, using a distinct `--output` directory
for each. Tracked source must be clean so the recorded revision identifies the
executed implementation. Missing browser binaries, unavailable official UI assets, failed
compilation under the allowed policy, and unavailable required profile files are
failures, never silently passing or skipped cells. Preparation is the only
network-dependent step in the suite; execution uses the verified local assets.

Artifacts include the source revision/tree, tracked-change status, command,
workflow run identifiers, OS/architecture, Node/Python/Playwright/browser versions,
fixture hashes, exact received policies, official UI ZIP and extracted hashes,
raw exported profiles and recorded method counts, visible DOM rows/body text,
screenshots, and console logs. Browser failures also retain Playwright traces.
Independent case results survive later failures. `--finalize` marks interrupted
or unstarted cases as failures without overwriting completed observations.
