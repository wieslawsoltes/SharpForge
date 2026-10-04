# Standalone worker startup correction

Work IDs: **SF-A19-T11.3 / #1580**, **SF-A19-T12.2 / #1583**.
This correction follows the failed actual `file://` workflow in hosted a4. It does
not turn that result into a pass. The complete offline workflow remains the
browser acceptance test, with the original non-null compiler metrics, lazy tool
activation, edit/build/debug/design/export, no HTTP attempts, and CSP assertions.

## Observed failure and reproducible input

Hosted source `8d1be9cffa04b0fd7390e5cb6fe5f6c03b997557`, tree
`dc9d4e337b91c6e878e7c6c7d65f013667b5ec6b`, run `37175293552`, job
`111356550684`, Chromium `153.0.8010.12`: the actual file navigation mounted the
workbench but compiler metrics remained null. The retained DOM trace showed
`SFEDITOR_FOLDING_PROVIDER: Worker failed to initialize` and then
`WORKER_FAILED: Restart the failed worker before requesting work`. No page error,
main-document CSP violation, or HTTP request attempt was recorded. The browser's
worker error event exposed no original message or error object to WorkerClient.

The one authorized diagnostic reconstruction, in a clean detached worktree at
that exact source, ran sequentially:

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
node scripts/limited.js node scripts/build.js
node scripts/limited.js node scripts/standalone.js
```

All three completed. The generated `artifacts/SharpForge-standalone.html` is
15,579,080 bytes and **byte-identical to the failed hosted artifact**, SHA-256
`acfc8f12940bb97ec2eaf7c305a023638213f4914fe96bd6ffac74515db05b70`.
Its embedded compiler worker is 5,526,193 bytes, SHA-256
`a5259b551f51155e9722b571d71d4a2131bc25112833e3521d9b4af3c0047663`,
and matches `dist/compiler.worker.js`. That source initialized over HTTP in a4.
The emitted worker is a closed strict IIFE, without executable `import`,
`import.meta`, `importScripts`, or startup child-worker URL resolution. Valid IIFE
syntax alone does not require a classic worker and is not the diagnosis.

## Origin-dependent loading mechanism

The source-supported explanation is the module worker loading path for an opaque
`file://` origin and its `blob:null/...` worker URL. Chromium's
`WorkerModuleScriptFetcher::NotifyClient` compares request and response origins
even for identical URLs; its classic worker loader's
`CheckSameOriginEnforcement` first accepts identical request and response URLs.
The latter does not take the module loader's opaque-origin comparison path.

Primary implementation references inspected:

- [Module loader, revision cc484c290cab98865a656a34a510b023ae405753](https://chromium.googlesource.com/chromium/src/+/cc484c290cab98865a656a34a510b023ae405753/third_party/blink/renderer/core/loader/modulescript/worker_module_script_fetcher.cc),
  `NotifyClient`, request/response check and rejection at lines 125–153.
- [Classic loader, revision 2654e16bae76f3b2c83f4b4381305ef4cda72e60](https://chromium.googlesource.com/chromium/src/+/2654e16bae76f3b2c83f4b4381305ef4cda72e60/third_party/blink/renderer/core/workers/worker_classic_script_loader.cc),
  `CheckSameOriginEnforcement`, URL equality before origin check at lines 67–76.
- [Current classic loader](https://chromium.googlesource.com/chromium/src/+/refs/heads/lkgr/third_party/blink/renderer/core/workers/worker_classic_script_loader.cc)
  retains this equality check (inspected blob `85a2ada8a0e659d6a269902e85e356a9cf74b3bc`).
- [Contemporaneous primary project report, MapLibre #8225](https://github.com/maplibre/maplibre-gl-js/discussions/8225):
  the report describes direct Blob module failure versus classic success from
  `file://` on Chromium/Edge 153. This is corroboration, not SharpForge validation.

The exact browser-side refusal text was not captured in a4, so this remains a
source-supported diagnosis pending the next actual file run. Generated runtime
errors never assert this cause when the browser supplies an opaque failure.

## Explicit asset format and diagnostics

`scripts/bundling/standalone.js` now adds the private generated-asset shape
`URL & {readonly workerType: 'classic'}` to only the closed embedded worker URLs.
The property is nonenumerable, nonconfigurable, and nonwritable. URL string
conversion and normal `new URL(asset)` behavior remain intact. URL allocation is
still lazy, cached by embedded asset, and revoked on non-persisted `pagehide`.

The public `workerOptions(asset, options)` helper in `@sharpforge/editor` is the
single format-selection seam used by compiler/runtime WorkerClient, workspace
search, metadata catalog, and editor regex search. It accepts only `classic` or
`module`. Normal URL objects and strings default to `module`; callers can
explicitly declare `options.type` for an ordinary asset. Copied/stringified URLs
drop the private declaration and remain ordinary module inputs. No URL protocol
heuristic, global Worker replacement, eval, or CSP relaxation is introduced.
Compute workers already create their own closed classic scripts and do not use
the standalone module asset resolver. Project tooling uses these shared compiler
and metadata hosts rather than another worker constructor.

WorkerClient preserves the native cause in memory and retains bounded message,
filename, coordinates, cause stack, worker identity, generation, and document
attribution. Explicit URL fields and URLs inside exported diagnostic strings
strip userinfo, query, and fragment capability data. Opaque events retain empty
original detail rather than a fabricated cause. Failed subsequent requests keep
the initial failure as their cause. Restart/generation and disposal behavior are
unchanged. Workflow startup failures now capture these bounded public-owner
diagnostics for both HTTP and file navigation and still rethrow the original
startup failure.

## Qualification status

The reconstruction above qualifies only the unchanged failing input's identity.
No post-correction tests, build, or browser run were performed in the owner
worktree. Root owns the completed correction cohort's serial qualification.

Authored Node regressions: `tests/a19-worker-assets.test.js` (five cases) covers
ordinary/external/borrowed URL formats, immutable declarations, invalid format,
compiler/runtime factory and restart behavior, opaque/native/synchronous errors,
bounded details, cancellation through restart, and secret-bearing URL metadata.
`tests/a19-standalone-worker-format.test.js` (one case) covers actual packager
output, nested worker messages in controlled VM contexts, options, lazy Blob
allocation, disposal, and exact unchanged CSP checks. These VM fixtures do not
simulate or qualify Chromium's origin enforcement.

Scheduled focused commands:

```sh
node scripts/limited.js node --test tests/a19-worker-assets.test.js tests/a19-standalone-worker-format.test.js tests/a19-worker-client.test.js tests/a19-static-bundle.test.js
node scripts/limited.js python -m unittest discover -s tests/conformance/browser -p 'test_workflow_*.py'
```

The Python command requires the repository's usual `PYTHONPATH=tests` and pinned
Playwright dependency. New diagnostics driver contracts contain four cases;
existing workflow-loading contracts remain eight. Actual offline browser
acceptance remains `tests/browser_vs_workflows_standalone_test.py` through the
shared launcher, production embedded CSP, and real file navigation. Firefox,
WebKit, Chromium file startup after this correction, and native/VS oracle
qualification are not claimed here.
