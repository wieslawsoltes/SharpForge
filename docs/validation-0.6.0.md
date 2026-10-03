# SharpForge 0.6.0 validation — October 2, 2026

## Results

| Gate | Observed result |
| --- | --- |
| Uploaded 0.5.0 baseline | 758 tests passed before implementation |
| Final Node suite | **1,006/1,006 passed**, 0 failures/cancellations/skips; +248 tests |
| JavaScript syntax | **99 modules**, 0 syntax errors |
| Browser acceptance | **108 passed** across five suites, no page JavaScript errors |
| Self-contained HTML | **21 passed**, two actual compiler/runtime workers |
| Isolated offline tarballs | **15/15 passed**, including both installed stdio executables and editor stylesheet |

Environment: Node v22.16.0, Chromium 144.0.7559.96, Linux x64. Reports: `core-results-0.6.0.tap`, `syntax-check-0.6.0.txt`, `validation-0.6.0.json`, `package-results.json`, `standalone-results.json` and the five browser reports below.

| Browser report | Checks |
| --- | ---: |
| `browser-results.json` | 29 |
| `browser-managed-results.json` | 12 |
| `browser-workspace-results.json` | 23 |
| `browser-release05-results.json` | 17 |
| `browser-release06-results.json` | 27 |

The existing suite filenames (and a few legacy suite label fields) are preserved; these current JSON files were regenerated on 0.6.0. Explicitly versioned 0.2–0.5 reports remain historical and are not counted as new 0.6 qualification.

## Scope exercised

Checked arithmetic and conversions, const expressions, using/disposal and actual InterfaceImpl metadata are tested through the IR VM, canonical CIL loader, ordinary direct CIL and IL export/reassembly. All eight delivered 0.6 examples also execute through all four paths. Tests cover lexical checked context, overflow before a property/array store, initializer failure, nested disposal exceptions, null resources, readonly bindings and GC retention across cleanup. Negative cases must issue diagnostics rather than silently substitute behavior.

Direct-IL tests cover pre-instruction snapshots, bounded history and opt-out, step back/reverse continue, storage write replay, arguments/locals/statics/fields/arrays/boxes, managed addresses, exception/finally continuation state, explicit collection, monotonic allocation identities, stale descriptors, conditional/hit breakpoints and DAP state. Independently hand-authored ordinary EXEs are opened through actual browser file inputs. Existing installed stdio subprocess/framing tests remain active; no external IDE client was used.

Editor/refactoring tests cover UTF-16 lexical windows, plain fallback limits, multiline trivia, bracket mapping, navigation history, stale selections, make-const type safety, preserved using scope, expression-body/conditional-return transformations and comment-loss rejection. Browser checks cover a 12,000-line disk file and a 300-line native replacement emitting duplicate input events, plus real undo, syntax selection, tab visibility, floating/redocking, compiler-worker generation and severity settings. The final browser rerun includes the queued ResizeObserver disposal guard and tab-strip correction.

The offline package gate packs all fifteen workspaces, installs their tarballs into an isolated temporary project without workspace links, imports public exports, compiles and executes real PE/CLI output, checks the new feature APIs and starts the installed LSP/DAP executables.

## Reproduction

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run test:packages
npm run standalone
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:managed
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:workspace
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser:release05
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser:release
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:standalone
npm run bench:release
```

Python Playwright and a compatible Chromium are needed only for browser acceptance; they are not application runtime dependencies. The CLI examples do not need them.

## Performance measurements and limits

`benchmark-results-0.6.0.json` contains warm single-process microbenchmarks on a shared container. The 20,000-line, 686,670-UTF-16-character full lexical index measured **335.58 ms median**; an indexed 440px viewport lookup measured **0.00584 ms median**. The latter excludes indexing, DOM painting and native text input: it is not an end-to-end editor frame time. Every supported-size edit still rebuilds the lexical index.

The checked/using compile-to-PE fixture measured 1.21 ms median, original IR execution 1.10 ms, and direct-CIL load plus execution 3.67 ms. A direct-IL debug fixture measured 2.40 ms with history off and 21.59 ms with history on; the enabled case also performs one reverse step. These are different workloads, not a claimed equivalent-cost comparison. Snapshot copying deliberately costs time and extra estimated host memory. No statistical claim about native typing latency, desktop CLR performance, all programs or all browsers follows from these numbers.

During investigation, one 300-line browser replacement dropped from about 4.96 seconds to 0.51 seconds after duplicate-input suppression. This was a single diagnostic probe, not a controlled multi-run benchmark; the release acceptance gate tests one revision and successful editing, not that exact speedup.

## Explicit qualification boundaries

Normal localhost HTTP navigation was attempted and rejected by this environment's Chromium administrator policy (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). No browser-policy bypass was performed. Browser acceptance therefore loads actual production modules and real workers using the documented in-memory harness. Standalone HTML is injected into about:blank, with harness storage shims. These results **do not validate normal HTTP/file-origin loading, native filesystem permission/write dialogs or durable browser storage**.

A desktop .NET/CLR and ILVerify toolchain was not available for a new independent run. The archive's optional native/WASM validation scripts and historical reports are not current qualification. No broad independent Roslyn-produced DLL corpus, external Visual Studio/VS Code client, native CLR attach, Portable PDB interoperability, hostile-binary security audit, hosted CI or public deployment was tested. Existing API/filesystem mocks are unit tests, not evidence of native integration.

The release is not full C#/CLR/MSBuild/Visual Studio parity. Reverse history is bounded and restores managed state, not external effects; the collector remains non-generational, non-moving mark-and-sweep. Generated/analyzed JavaScript callbacks are trusted extensions, not a Roslyn binary host or an isolation boundary for hostile code.

## Fresh source archive

A separate extraction of the source ZIP installed the local workspaces offline, passed **1,006/1,006 tests** and all **99 syntax checks**, rebuilt the static and standalone applications, executed the CheckedResources solution with `checked project`, `-2147483648`, `disposed`, and invoked the ordinary StorageWrites.exe with return value **42**. All **247 authored source/configuration/example files** matched the release SHA-256 manifest. The independently rebuilt standalone HTML was byte-identical to the delivered build. Evidence is in `fresh-build-0.6.0.txt`, `source-manifest-0.6.0.json` and the machine-readable release report. Final packaging also includes these generated reports; no code changed after the verified source manifest.
