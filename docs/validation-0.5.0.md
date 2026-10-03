# SharpForge 0.5.0 validation — 2026-10-02

## Results

| Gate | Result |
| --- | --- |
| Node regression suite | **758/758 passed**, zero failures or skips; uploaded baseline was 544 |
| JavaScript syntax | **90 modules checked**, zero errors |
| Production browser acceptance | **81 checks passed** across four suites; zero page JavaScript errors |
| Self-contained HTML | **17 checks passed**, 2 actual dedicated workers |
| Isolated offline packages | **15/15 tarballs** installed, imported, compiled and executed; both installed stdio executables started successfully; exported editor CSS resolved |

Node: `v22.16.0`. Chromium: `144.0.7559.96`. Platform: `Linux-6.18.44-x86_64-with-glibc2.41`. Machine-readable evidence: `validation-0.5.0.json`, `core-results-0.5.0.tap`, `syntax-check-0.5.0.txt`, the four browser report files, `standalone-results.json` and `package-results.json`.

## What was actually exercised

Property/finally cases run through the IR VM, canonical PE/CIL reload VM, direct-CIL VM, and text-export/reassembled IL. Tests cover get/set and private accessors, initializers, read-modify-write evaluation order, getter-only assignments, real property metadata, invalid writes/accessor calls, nested return/break/continue cleanup, replacement exceptions and lexical rethrow, GC roots, pending snapshots and existing behavior.

Direct debugger tests use independently hand-authored ordinary DLLs without #SF, actual decoded byte offsets, condition/hit/log breakpoints, argument editing, safe watches, next/out, exceptions, DAP launch/restart/disassembly. Primitive opcode fixtures cover fixed-width sizeof, cpobj through managed addresses, unbox address mutation and GC rooting, and rejected unknown layouts/boxed types.

Structural refactorings are compiled/executed before and after, including unsafe extraction and mutated/nameof exclusions, collision avoidance, stale transactions and type preservation. Editor helpers cover UTF-16 positions, lexical bracket contexts, literal replacement and resource budgets. Browser checks exercise actual editor replacement undo, property refactoring undo, line navigation, brackets, generated properties, direct IL steps/restart/run-to, floating/redocking, disk DLL/EXE inputs, and the new disk SLNX/csproj.

Stdio tests spawn local Node processes and exchange real Content-Length messages. LSP initializes, publishes UTF-8 source diagnostics, shuts down and rejects later requests. DAP loads a disk DLL through the trusted host, pauses, exposes instruction references, continues and terminates. Framing tests cover one-byte splits, coalesced messages, truncation, malformed headers/envelopes, invalid UTF-8 and bounded buffering. Package verification repeats executable startup from installed tarballs, not workspace symlinks.

## Reproduction

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run test:packages
npm run build
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:managed
CHROMIUM_EXECUTABLE=/usr/bin/chromium SHARPFORGE_IN_MEMORY=1 npm run test:browser:workspace
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser:release
npm run standalone
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:standalone
```

Browser tests require Python Playwright and an installed Chromium; none of those tools are runtime dependencies of the app. The fresh-archive gate is recorded separately below.

## Explicit qualification limits

Production scripts and real workers were loaded by the documented in-memory browser harness. A normal localhost HTTP navigation attempt failed with Chromium's environment administrator block (`ERR_BLOCKED_BY_ADMINISTRATOR`); no browser-policy bypass was performed. Standalone HTML was injected into about:blank. These runs **do not validate normal HTTP/file-origin loading, native directory permission/write dialogs or durable browser storage**. Earlier mock-based filesystem tests remain ordinary unit tests, not proof of native dialogs.

No desktop .NET/CLR or ILVerify toolchain was available for a new independent interoperability run. The optional native CI fixture runner now includes the new examples, but that matrix was not executed here. No broad independent Roslyn-produced DLL corpus, Visual Studio/VS Code client integration, hostile-binary security audit, hosted CI or deployment was performed. Historical CLR/WASM/benchmark reports in the archive are retained as historical evidence only, not counted as current passes. No relative performance or full language/runtime/product parity claim follows from these tests.

## Fresh source archive

A separate extraction of the source ZIP installed all local workspaces offline, passed **758/758 tests**, rebuilt the browser application, ran the PropertiesAndCleanup solution with output `cleanup` then `42`, and invoked PrimitiveAddresses.exe with result **52**. The same release source and package lock were used; generated documentation/reports are included in the final archive.
