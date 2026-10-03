# Current validation: SharpForge 0.9.0

See [0.9.0 results and limitations](validation-0.9.0.md). The sections below are historical and are not fresh evidence for the current build.

# Current release

See [0.8.0 validation](validation-0.8.0.md) for the current evidence. The material below is historical; unversioned JSON reports are updated by current test runs.

# SharpForge 0.4.0 — local validation

Validation of the included implementation, not complete C#/CLR/MSBuild/Visual Studio conformance. Machine-readable summary: [validation-0.4.0.json](validation-0.4.0.json). New source is built from the supplied 0.3.0 archive.

## Actual results

| Layer | Result | Evidence |
| --- | --- | --- |
| Node regression tests | **544 passed**, zero failures/skips; 143 more than 0.3.0 | `core-results.tap` |
| JavaScript syntax | **77 modules**, zero syntax errors | `syntax-check.txt` |
| Original browser acceptance | **29 passed** | `browser-results.json` |
| Managed DLL / IDE acceptance | **12 passed** | `browser-managed-results.json` |
| Disk / docking / workspace acceptance | **23 passed** | `browser-workspace-results.json` |
| Browser total | **64 checks**, no JavaScript errors | The three reports above |
| Self-contained HTML | **13 checks passed**, two real workers | `standalone-results.json` |
| Reusable packages | **15 version-0.4.0 tarballs** installed and imported offline in an isolated project | `package-results.json` |
| Examples | 14 source examples (13 executable, one deliberate diagnostics case); six disk directories / seven manifest configurations | `examples/coverage.json`, `tests/release04.test.js` |
| Benchmarks | Frontend/heap and paired canonical-profile IL benchmarks rerun | `benchmark-results.json`, `il-benchmark.json` |

Node v22.16.0, Linux x64, Chromium 144.0.7559.96, Python Playwright. Core C# examples execute through the original IR engine, canonical DLL loader and separate direct-CIL engine. The packages test imports all 15 installed public entries and exercises DLL output/loading, no-#SF CIL/IL-text execution, generators, refactoring, project loading, docking model operations, UTF-16 search and library static initialization without source-workspace symlinks.

## Added regression coverage

The 143 added Node tests include 64 project/docking tests, 63 dedicated release tests, and 16 additional cases produced by the existing sample test loops. Coverage includes bounded XML, entities/DTD rejection, path normalization/globs, configuration conditions, inherited props/targets data, project references/cycles, source membership, unsupported dependency diagnostics, permission/conflict preflight and recheck, partial-write reporting, layout validation and randomized mutations, partial classes, nameof, library emission/initializers, versioned search/replace, call hierarchy/LSP shapes, snapshot-safe handles, paged heap/census/retaining-path limits and CLI project examples. The docking tests include 500 randomized moves with validation.

The 23 new browser checks exercise all 21 tool identities, no shared legacy tool area, split-editor buffer/undo preservation, multi-file validated edits, comment/line/IME handling, floating move/resize, keyboard split sizing, auto-hide/pin, actual HTML drag-to-edge, named layout restore/invalid rollback, real separate tool and document windows, live worker output/editing across those windows, child-close reattachment, actual directory file input loading of SLNX/project references, malformed import rollback, unsupported package blocking, a library method returning 42, a separately opened DLL returning 43, EXE entry-point execution, full IL/history, find/replace preview, source call hierarchy, seven language examples, heap controls and desktop/light/mobile rendering.

The managed-IL browser suite still rebuilds changed `add` IL into `mul` and waits for **48**, distinguishing new execution from earlier results. The expanded standalone suite adds actual disk-project directory input, split editors, floating/redocking and a library static-initializer invocation returning **45**. These are actual compiler/runtime workers, not mocked compile or execution results.

## Performance evidence

These are warm synthetic measurements in a shared AMD EPYC 7763 container, not comparative CLR/Roslyn claims or guaranteed speedups. Stage timings do not measure complete UI latency. The approximate 10K-line fixture has 9,951 simple source lines. The GC row includes allocation, a live trace and a dead sweep; it is not a GC-pause-only benchmark.

| Workload | Median ms | p95 ms |
| --- | ---: | ---: |
| full parse + bind + emit: approximately 10K lines | 55.83 | 76.28 |
| one-file edit in approximately 10K-line workspace | 11.83 | 12.14 |
| GC: trace and sweep 10,000-object chain | 7.81 | 16.70 |

Full raw distributions, methodology and host metadata are retained in the JSON reports. The separate IL benchmark tests one-time canonical decode/verification followed by the original VM hot loop; it does not benchmark arbitrary-DLL direct-CIL execution. Historical 0.2 analyses are labeled and must not be read as new 0.4 measurements.

## Browser, disk and independent-runtime qualifications

Normal browser URL navigation, including localhost, was blocked by the environment. That policy was not changed. Tests injected the built application into `about:blank` and ran its actual production modules/workers. The static-app harness uses a test-only memory-storage shim where needed; standalone tests inject the actual self-contained HTML and use normal application storage-failure handling. File inputs received real local project/DLL/EXE files, and real child windows were opened. These tests do **not** validate normal HTTP/file-origin navigation, hosting CSP, native persistent storage, popup policy on every browser or native filesystem write permission dialogs.

Native disk-save preflight, permission denial, conflicts, rechecks and partial-write failure behavior have unit tests using file-handle mocks. Real browser writable streams were not qualified. Saving is sequential and not an atomic multi-file transaction; a race after preflight remains possible.

No new desktop CLR/ILVerify, independent .NET differential run, broad third-party DLL corpus, external LSP/DAP client, hosted CI or public deployment was validated. Earlier independent-runtime reports remain historical. The source includes CI/release workflows, but including them is not evidence of a hosted run.

## Product boundaries

The project loader is a documented subset, not full MSBuild/NuGet. Project references combine source into one compilation rather than linking independently built assemblies. Full C# semantics, BCL/generic/value-type and multi-assembly execution, arbitrary faithful high-level decompilation, Roslyn binary extensions, arbitrary-DLL source debugging and Portable PDBs remain incomplete. Docking supports real live panels, splits and browser popouts, not native Visual Studio, exhaustive accessibility/touch or pixel-exact parity. The collector remains a bounded, non-generational, non-concurrent mark/sweep logical heap.

## Reproduction

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run check
npm run test:packages
npm run build
npm run test:browser
npm run test:browser:managed
npm run test:browser:workspace
npm run standalone
npm run test:standalone
npm run bench
npm run bench:il
```

Browser suites require Python Playwright and Chromium. In an environment that cannot navigate HTTP, the explicit `SHARPFORGE_IN_MEMORY=1` harness mode runs production code without modifying browser policy. Set `CHROMIUM_EXECUTABLE` to the installed Chromium path when needed. That mode is validation infrastructure, not a substitute for testing a real deployment.
