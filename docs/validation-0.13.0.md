# SharpForge 0.13.0 — validation

Validated from the uploaded, previously verified 0.12.0 source plus this release's implementation. Tests are functional/regression evidence, not a claim of full C#/BCL/WinUI compatibility.

## Recorded gates

| Gate | Result |
|---|---|
| Node regression suite | 2,264 passed; zero failures, cancellations or skips. Baseline: 2,023; net increase: 241. |
| JavaScript syntax | 208 modules; zero errors. |
| Chromium acceptance | 312 checks across 13 suites, all process exit codes zero. |
| New source-sync/animation acceptance | 16 checks; production editor, compiler/runtime workers and actual DOM behavior. |
| Standalone HTML | 54 checks; two real Blob workers; no page or console errors. |
| Offline package install/execution | All 23 versioned tarballs installed in an isolated project without workspace symlinks. |
| Native Microsoft SDK/MSBuild | Unavailable: `spawn dotnet ENOENT`; gate reports false/available:false. Not counted as a pass. |

Node: 22.16.0. Browser: Chromium 144.0.7559.96, headless. The Python Playwright requirement is pinned in tests/requirements.txt. Installed executables LSP, DAP and the native host help are exercised by isolated package verification.

## Coverage

New collection/text/interpolation cases compile and execute through source VM, canonical CIL reload, direct CIL and exported/reassembled IL. Tests cover receiver/key single evaluation, versioned enumeration failure/disposal, collection GC roots, dictionary key behavior, bounds/capacity failures, exact supported formatting, incomplete syntax and type rejection.

Source tests cover minimal and structural edits, no-op byte identity, comments/CRLF/UTF-16, repeated event-handler protection, stale baselines, dynamic expression protection, style/template/Grid preservation, wrap-grid spans, explicit non-Button style targets and activation ownership. Browser tests use the real CodeEditor to edit, undo and redo. Candidate failures retain the preview, concurrent edits reject rather than overwrite, and retained managed handlers execute after synchronization.

Timeline tests cover duration, offset, nested speed, repeat, reverse, easing endpoints, pause/resume/seek/fill, target/name validation, garbage collection, state snapshots and base/style changes during animation. The independent JS facade is tested against DOM properties and measured wrap positions. Both managed engines complete a running animation after Main and dispatch actual managed Completed handlers. The standalone bundles these same implementations; no module network loading is needed in its test.

The original debugger, project/ZIP wizard, native explorer filesystem, extension, docking, live designer and Edit and Continue tests remain included. The async browser predicate helper was corrected to await the resolved predicate value before declaring success; it no longer relies on a Promise object being truthy. A delayed callback therefore must actually occur for its wait to pass.

## Browser modes and limits

Normal loopback HTTP navigation was attempted again and blocked by runner policy (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). Browser acceptance uses production modules and actual compiler/runtime workers loaded through the documented in-memory harness. Storage uses the harness shim; this does not qualify persistent browser storage, normal HTTP/file URLs or native picker permissions.

The native Explorer suite uses production client/API logic, real loopback HTTP and a temporary physical filesystem, with a byte-forwarder only for browser transport. Native build behavior in adapter tests uses an explicit simulator; the real SDK gate remains unavailable. Physical WebGPU was not available. Canvas2D/DOM and renderer-selection/fallback contracts have the existing coverage; new transforms conservatively use DOM when required.

Native CLR consumption, general BCL/generic assemblies, Windows App SDK execution, external IDE clients and operating-system thread behavior are not qualified by the JavaScript managed-profile tests.

## Delivered-archive gate

The release procedure validates the **exact source ZIP intended for delivery**, not a reconstructed subset:

1. CRC-check and extract into a new directory; compare SOURCE-MANIFEST.json hashes, lengths and listed directories before running anything.
2. Install offline with scripts disabled; run all Node tests and syntax checks.
3. Rebuild browser and standalone artifacts; execute the new CLI examples.
4. Install and execute all 23 freshly repacked tarballs independently; compare each package and standalone HTML byte-for-byte with the delivered artifacts.
5. Run the source-sync browser suite and standalone suite again in that extraction.

The external `SharpForge-0.13.0-final-archive-verification.txt` records these post-packaging commands and their observed results. The release is only delivered after that gate succeeds. Source-manifest scope is explicit in the manifest; the manifest itself is protected by the source ZIP checksum.

## Reproduction

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run build
node scripts/standalone.js
npm run test:packages
CHROMIUM_EXECUTABLE=/path/to/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:sync
CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:standalone
node apps/cli/main.js run examples/release13/BclDictionary/BclDictionary.slnx
```

Use the normal HTTP test mode on an unrestricted machine for additional deployment qualification. Native SDK tests deliberately fail rather than reporting success when prerequisites are missing.
