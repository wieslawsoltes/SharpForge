> Historical report text from the supplied 0.3.0 release. Non-versioned report paths now contain the 0.4.0 rerun; consult the original 0.3.0 archive for its original non-versioned evidence.

# SharpForge 0.3.0 — local validation

This is validation of the included implementation, not full C#/CLR/Visual Studio conformance. Machine-readable evidence: [validation-0.3.0.json](validation-0.3.0.json).

## Actual results

| Layer | Result | Evidence |
| --- | --- | --- |
| Node regression tests | **401 passed**, zero failures/skips: 305 original + 96 new | `core-results.tap` |
| JavaScript parsing | **64 modules**, zero syntax errors | `npm run check` |
| Original browser acceptance | **29 passed**, real compiler/runtime workers | `browser-results.json` |
| DLL/IDE browser acceptance | **12 passed**, no JavaScript errors | `browser-managed-results.json` |
| Standalone HTML | **9 checks passed**, both real workers | `standalone-results.json` |
| Independent package installation | **13 version-0.3.0 tarballs** installed/imported offline in an isolated project | `package-results.json` |
| CLI/examples | Inspect/invoke/decompile/IL assemble/entry-point workflows in regression suite; Language03 example ran | `tests/managed-il.test.js`, `examples/Language03.cs` |
| Performance | Frontend/heap and paired canonical-profile IL microbenchmarks rerun | `benchmark-results.json`, `il-benchmark.json` |

Node v22.16.0, Linux x64; Chromium 144.0.7559.96, Python Playwright. No package registry publication or hosted repository deployment was performed.

## New verification coverage

The 96 added Node tests comprise 56 managed-IL/metadata/decompiler/GC/CLI cases and 40 language/extension/refactoring/LSP cases. These cover independently hand-authored ordinary PE/CIL DLLs without #SF; library method arguments/returns; long/unsigned/float/byte/short semantics; branches/switch; static initialization/byrefs/finally; limited execution budgets; unsupported external/native paths; malformed PE and signatures; MethodSpec decoding; edited IL execution and omitted-body rejection; conservative C# reconstruction/fallback; strong/weak handles and reusable scratch memory; source generators/cache/failure rollback/limits; analyzer policy; version-safe transactional edits; LSP capabilities and messages. New C# fixtures execute through the original IR engine, canonical DLL loader and direct-CIL engine.

The 12 browser checks verify ordinary DLL opening without replacing the source project; explicit invocation; C# reconstruction; actual changed IL execution; all-method IL; rejected unsupported calls/malformed DLLs; generators and read-only generated views; Ctrl+. and editor undo; Shift+Alt+F; desktop/390px rendering; no JavaScript errors. The edited arithmetic test uses `[6,8]` and waits for **48**, different from the earlier 42 result, to rule out stale-state success.

The standalone check additionally repeats original source debugging, ordinary DLL inspection, changed IL returning 48, and generation/compilation/execution from the actual self-contained HTML. Isolated package checks import all 13 installed tarballs, compile/inspect/load/run real DLLs, execute a no-#SF binary and its IL text round-trip, run a generator, and apply a type refactoring without source-workspace links.

## Browser and independent-runtime qualifications

The environment blocks normal browser URL navigation, including localhost. That policy was not changed. Tests load the built application into `about:blank` and execute the actual bundled production workers. The static-app harness uses a test-only memory-storage shim. Standalone HTML is injected directly and uses the application's normal storage-failure handling. **Normal HTTP/HTTPS or file-URL loading and durable native storage were not verified.** Neither Firefox/Safari, physical touch hardware, a full accessibility audit, nor real external Visual Studio/LSP/DAP clients were tested.

No desktop `dotnet`, CoreCLR or ILVerify run was available for 0.3, and no independent Mono/WASM rerun was performed. The input archive's 46 successful independent Mono .NET WASM fixtures are preserved in `clr-wasm-results-0.2.0.json` and [historical validation](validation-0.2.0.md), with their test-only forwarding-facade limitations. They are **historical evidence, not 46 new checks**. The newly authored ordinary-DLL fixtures do not establish broad Roslyn-generated third-party DLL compatibility or full BCL/type-system behavior.

## Current microbenchmarks

Shared Linux container, warmed JavaScript process, no CPU isolation/forced host-GC, no comparison to CLR/Roslyn. These measurements are not browser typing-latency, UI frame-rate or security/conformance results. The predecoded IL and original IR use the same VM; the new direct-CIL interpreter is **not** the subject of the paired IL benchmark.

| Workload | Median ms | p95 ms |
| --- | ---: | ---: |
| full parse + bind + emit: particle project | 0.8164 | 1.5035 |
| full parse + bind + emit: approximately 1K lines | 4.3305 | 6.6178 |
| full parse + bind + emit: approximately 10K lines | 47.2489 | 61.9549 |
| unchanged workspace result cache lookup | 0.0003 | 0.0008 |
| one-file edit in approximately 10K-line workspace | 10.3902 | 13.6151 |
| VM: 10,000-iteration integer loop | 3.3868 | 19.9236 |
| GC: trace and sweep 10,000-object chain | 6.3573 | 11.7831 |

Canonical-profile paired execution ratios (IL-predecoded/original IR) were 1.000 for the integer loop, 1.008 for calls/arrays, and 0.957 for allocation/collection in this run, with identical instruction counts per workload. These are warm microbenchmark ratios, not promised speedups. First canonical decode/verification adds separate cost: about 16.34 ms for the 1K-line workload and 106.95 ms for 10K lines in this run. Raw observations and methodology are retained in `il-benchmark.json`; the historical 0.2 reports remain separately labeled.

## Reproduce

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run test:packages
npm run build
npm run test:browser
npm run test:browser:managed
npm run standalone
npm run test:standalone
npm run bench
npm run bench:il
```

Browser tests require Python Playwright and a compatible installed Chromium. Set `CHROMIUM_EXECUTABLE` to a known browser path. Only in policy-restricted environments, `SHARPFORGE_IN_MEMORY=1` selects the documented alternate harness; it does not bypass or modify browser policy. CI is configured for the normal HTTP path, but has not run on a hosted repository for this release.

## Remaining qualification

Full CLI type verification, generic/value-type semantics, cross-assembly dependency binding, broad BCL behavior, malformed-input security review, external DLL corpora, complete C# reconstruction, every IL/PE editing layout, source debugging for arbitrary DLLs, production plugin isolation and full IDE/protocol parity remain open engineering/qualification work. See [managed-IL contract](managed-il.md) and [compatibility](compatibility.md).
