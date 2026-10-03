# Validation — SharpForge 0.14.0

## Environment and baseline

Source input: mounted SharpForge-0.13.0-source.zip; baseline 2,264 Node tests passed before changes. Linux x64, Node v22.16.0, npm 10.9.2, Python Playwright, Chromium 144.0.7559.96. clang 17 rebuilt the checked-in authored SIMD kernel and generated JS bytes identically. No .NET SDK/MSBuild executable is installed. `npm run test:msbuild:native` exits 1 with available:false and dotnet ENOENT; this is an unavailable qualification, not a passing test or simulator substitute.

## Observed final implementation checks

| Gate | Observed result |
|---|---|
| `npm test` | 2,574 passed; zero failures/canceled/skipped; baseline +310 |
| `npm run check` | 232 JavaScript modules, zero syntax errors |
| 14 browser suites | 329 checks, all suites exit 0 |
| New runtime browser suite | 17 checks; real browser Fetch/worker tasks; three actual HTTP requests in that run |
| Standalone | 61 checks; real production compiler/runtime workers and nested numerical workers; zero page/console errors |
| `npm run test:packages` | all 25 tarballs installed offline in an isolated directory without workspace symlinks; actual compute/HTTP and installed LSP/DAP executables |
| clang SIMD regeneration | WASM and embedded JS SHA-256 unchanged |
| Native SDK gate | unavailable (dotnet ENOENT), not counted as success |

Logs are in core-results-0.14.0.tap, syntax-results-0.14.0.txt, package-results.json, standalone-results.json, browser-suite-0.14.0.json and each browser result JSON. Browser suite sizes: core 29, managed 12, workspace 23, release05 17, release06 27, MSBuild 32, Explorer 37, native Explorer 13, debugger 41, advanced 22, templates 23, designer 20, source-sync 16, new runtime 17. Each count is a recorded acceptance check, not a count of independently installed platforms.

Node coverage includes selected stable/preview syntax gates, source/IL round-trip output, collection evaluation order/cleanup/DA diagnostics, four managed execution paths, Array overlap/type/range failure atomicity, seeded Random restore, bounded JSON/raw/duplicates/disposal/GC, scalar/SIMD numerical edges and actual worker identities, input ownership, queued and active cancellation, deadline/result races, failure/disposal and input-byte budgets. Network checks use actual local HTTP and authored local WebSocket servers (text/binary frames, policy denial, redirects, headers, response cap, queue/cancel/disposal), managed HttpClient in both engines, host roots/pending epochs/old snapshots, external evaluation rejection and stale completions. Policy-denied cases prove no server requests were made.

Browser acceptance runs actual production JS and real compiler/runtime workers through the existing in-memory HTML loader. That loader does not validate normal HTTP/file URL navigation or durable browser storage; it supplies a test storage shim. The new networking suite uses ordinary browser Fetch to a real local CORS HTTP server without intercepting/stubbing Fetch. Compute jobs use actual independent Blob workers and WASM instantiation, not JavaScript test doubles. The native Explorer suite separately uses the real local host and temp disk through its documented byte forwarder; MSBuild simulation in older adapter tests does not count as native SDK execution.

The standalone HTML uses its embedded production modules, two main workers and nested worker factory. Tests exercise stable/preview code, JSON, actual SIMD, real isolated compute and default HTTP denial, plus the previous debugger/designer/style/animation/source-sync workflows. Local-file browser behavior is not inferred from about:blank injection.

## Reproduction

```
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run standalone
npm run test:packages
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:runtime
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:standalone
npm run bench:runtime
npm run bench:compute
```

Python browser dependencies are in tests/requirements.txt. The general/new browser workflows support an installed Playwright Chromium or CHROMIUM_EXECUTABLE. CI includes the new suite but hosted CI execution is not claimed. Tests use in-memory mode here because normal navigation was blocked by runner administrative policy. Native gates remain separate.

## Artifact qualification

The final-archive-verification.txt delivered next to the archives records independent extraction, per-file SHA-256/length checks, offline install, tests, syntax, rebuild, CLI cases, isolated packages and critical fresh-extraction browser suites. Standalone and package identity must be compared by bytes after rebuilding, not inferred from a successful build command. This document records the working-tree observations; the separate archive log is the authority for archive-specific results.

Not qualified: native SDK/CLR execution or latest preview Roslyn differential comparisons, arbitrary third-party DLLs, native PDB/IDE integration, durable browser state, native picker permission dialogs, normal navigation, physical WebGPU, remote TLS services/enterprise auth, raw networking or true managed OS threads. No full language/runtime/network compatibility or independent security audit is claimed.
