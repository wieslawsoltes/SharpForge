# A05 browser qualification

The focused [workflow](../.github/workflows/a05-browser.yml) runs Chromium, Firefox,
and WebKit serially on `ubuntu-latest`. It runs on manual dispatch, pushes to
`codex/a05-e01-started-handoff-20261004`, or other PRs with an `SF-A05` title and
the `full-ci` label. Same-repository PR jobs for that continuation branch are
suppressed; fork PRs retain the title/label gates. The scoped push trigger tests
the actual branch head even when changes on `main` block a PR merge revision.
It has read-only repository
permissions, a 25-minute bound per engine, and always uploads results, including
dependency/setup failures. It does not infer browser results on Windows/macOS or
replace the separate Studio browser matrix and native CLR qualification.

Workflow concurrency uses the event, source repository and branch. New pushes
cancel outdated push runs, PR updates retain cancellation, and manual dispatch
retains its non-canceling policy. Skipped PR events cannot cancel push runs.
Push artifacts retain the actual checkout revision/tree and event SHA/ref;
they do not claim a PR merge revision or fabricate PR metadata.

No browser result is established merely by adding this workflow. Acceptance
requires completed `report.json` case rows from the exact tested revision. The
Node fixture tests and Python evidence-validator tests are useful regressions but
cannot establish actual browser, CSP, or Speedscope UI behavior.

## Cases and evidence

| Case | Actual observation required |
| --- | --- |
| `wasm-execution` | A real prepared CIL method instantiates in browser WebAssembly and uses native arithmetic. Its output, full instruction profile, and instruction count equal interpreted CIL; a zero-time slice executes nothing. |
| `wasm-heap-bridge` | The shared independent CIL fixture executes every selected instruction through an actual native module. Observed native allocation/field/array/return imports, managed writes, instruction/profile counts, allocation and GC counters match interpreted CIL; collection before every instruction and after return preserves the managed result. |
| `debugger-deopt` | A hot loop enters Wasm through OSR, a real `CilDebugSession` instruction breakpoint deoptimizes it, and single stepping exposes the expected PC, locals, and operand stack. Resume uses canonical arithmetic and cannot silently select Wasm again. |
| `profile-exports` | Source, reloaded source image, and CIL guest programs execute and export actual recorded instruction profiles. The profile files and exact VM method counts are retained. |
| `csp-denied-fallback` | A separate real HTTP document omits `wasm-unsafe-eval`. The same valid native module compiles under the allowed policy and fails with a native CSP `CompileError` under denial. Actual generated-code compilation fails with `WASM_COMPILE`, and tiering records fallback while interpreted execution produces the correct result. Policy events are validated whenever delivered; WebKit may instead establish denial through the paired native compilation proof. |
| `speedscope-source`, `speedscope-reload`, `speedscope-cil` | The official UI imports each generated file through its real file input. Its visible Sandwich table must contain every recorded method with the exact displayed Total and Self counts; the sum of displayed Self counts must equal actual VM instructions. |

The runtime documents use the shipped `createBrowserCsp()` value with one added
hash for the fixture import map. The denial document removes only
`wasm-unsafe-eval`. Modules resolve through public package entry points. These
pages exercise the runtime under HTTP CSP; they do not imply a Studio UI result.
The official offline Speedscope assets use a separate local HTTP origin and do
not stand in for the product's CSP. External requests are blocked and fail the
case. No guest profile is uploaded to a third-party service.

The heap bridge is the eighth independent case, added after the original seven
case reports. Earlier seven-case successes retain their original scope; they do
not qualify this addition. Its fixture is shared with
`tests/a05-11-wasm-runtime-bridge.test.js`, and the report fingerprints both the
shared input and its independent CLI metadata builder. A temporary observer
forwards every `WebAssembly.instantiate` call to the unchanged native function
and forwards each imported helper unchanged while recording actual invocations.
It requires a real `WebAssembly.Module` and `WebAssembly.Instance`, the complete
selected instruction sequence, three allocation imports, three field imports,
two array imports and one return import. Preparing a handle followed by an
interpreter-only fallback cannot pass. The observer restores the original native
property after preparation; it does not supply a replacement interpreter or
synthetic GC result. No host handle or pin is added to retain the guest result.
Weak string interning keeps the literal pool from concealing a missing return
root: the result must survive collection with the VM root, then become an expired
managed reference after that root is cleared and collection runs again.

The shared browser launcher rejects unexpected CSP events. Only the dedicated
denial case accepts its expected negative launch result, after validating the
document URI, enforced script directive, and `wasm-eval`/`eval` blocked URI.
Chromium and Firefox require that policy event. WebKit 26.6 in the actual CI run
rejected compilation without delivering an event. For that engine only, absence
of an event requires the independent paired native compilation proof: identical
valid bytes must compile under the allowed policy, then fail as a native
`WebAssembly.CompileError` whose message identifies CSP in the denial document.
Missing controls, malformed-byte failures, other error types, and unrelated
policy events fail. The row explicitly records `eventObserved: false` in that
case; no event is inferred. The successful runtime observation is saved before
validating the launcher outcome, so a later monitor failure cannot erase it.

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

Repeat serially for `webkit`. For Firefox on Linux, run the actual browser headed
under Xvfb so the official UI has a WebGL context:

```sh
python -m playwright install --with-deps firefox
xvfb-run --auto-servernum python tests/fixtures/a05-browser/qualify.py --engine firefox --headed
```

Use a distinct `--output` directory for each engine. This follows
[Playwright's headed Linux CI instructions](https://playwright.dev/python/docs/ci#running-headed);
it does not disable browser security or replace WebGL. The original headless
Firefox run at `e09324d3` failed before import with exhausted GL driver options
and Speedscope's `Setup failure`. Each UI case now records the native WebGL
availability, version, vendor, and renderer before attempting import. The launch
options are recorded both in the report and each browser session. Headless mode
remains the default for the shared launcher, Chromium, and WebKit. Tracked source must be clean so the recorded revision identifies the
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
