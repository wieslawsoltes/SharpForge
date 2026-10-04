# A05 browser and actual x86 qualification — 2026-10-04

These are unmodified remote CI observations for pushed commit
`312cd9242a492ce6f03e7e034a51cc17669a7edf`, tree
`21dd929c4087bb7dc97fdd735d88ae36d1e76050`.
This first archive batch contains the three completed browser cells and two
completed actual Windows x86 native-width cells. The six standard native matrix
cells are a separate, still-running qualification at the time of this archive.

Completion addendum: all six standard native cells subsequently finished.
Their original 34-case reports, explicit unsupported outcomes and exact provenance
are retained in [standard-native/](standard-native/README.md). That separate archive
records 191 passes, zero failures and 13 unsupported results across 204 outcomes.

| Browser | Actual version | Launch | Cases passed | Cases failed |
| --- | --- | --- | ---: | ---: |
| Chromium | 153.0.8010.12 | Headless | 7 | 0 |
| Firefox | 155.0 | Headed under Xvfb | 7 | 0 |
| WebKit | 26.6 | Headless | 7 | 0 |

All three used Playwright 1.63.0. Each report records Wasm execution, debugger
deoptimization, profile exports, CSP fallback, and opening source/reloaded/CIL
profiles in the official Speedscope UI. The three profile exports, observed DOM
method tables, graphics probes and screenshots are retained. Chromium and Firefox
observed `securitypolicyviolation` events. WebKit's denied case records the actual
native CSP-specific `CompileError` with a valid-module allowed-page control;
it did not deliver a violation event. No browser is counted from a session log
alone: all seven case records and the final aggregate report passed.

| Windows x86 cell | Actual SDK | Actual guest runtime | Process | `IntPtr.Size` | Result |
| --- | --- | --- | --- | ---: | --- |
| SDK 8 | 8.0.425 | .NET 8.0.31 | X86 / win-x86 | 4 | Passed |
| SDK 10 | 10.0.201 | .NET 10.0.5 | X86 / win-x86 | 4 | Passed |

These are actual 32-bit CLR processes. Each qualification compares the native
fixture with the same Roslyn DLL in the CIL VM and with source, reloaded-source
and compiler-emitted CIL execution configured for the observed 32-bit width.
The fixture checks native-size queries, unchecked and checked overflow, mixed
arithmetic, shifts and byref array access. It does not claim that a configured
32-bit VM running beside a 64-bit CLR establishes native 32-bit parity.

Both cells used source SHA-256
`b764599bc1399b0a3af0b53fa0a747a0abb811531c778cd2f1a56673bd1c3533`.
The installer record retains the exact official script URL/hash and installed
host, compiler and CoreCLR file hashes. The independent guest-runtime probe uses
the same executable and runtime configuration as the fixture; its actual output,
source/assembly/configuration hashes and exact command are retained in the report.
The SDK 10 guest actually selected .NET 10.0.5, rather than inferring a runtime
patch from the SDK version or another matrix cell.

## Authoritative records

- [Native run 37225004330](https://github.com/wieslawsoltes/SharpForge/actions/runs/37225004330)
- [Browser run 37225004274](https://github.com/wieslawsoltes/SharpForge/actions/runs/37225004274)
- [Artifact provenance and retained-file hashes](manifest.json)

All five ZIP SHA-256 values were checked against GitHub's upload digests before
extracting these files. Reports, authored inputs, expected outputs and installation
logs were copied byte-for-byte; no fixture or output was regenerated. The manifest
records exact artifact IDs, URLs, sizes, digests, job IDs, original entry paths and
individual retained-file hashes. Executable third-party Speedscope assets, generated
DLLs, raw ZIPs and Playwright trace ZIPs remain in the original workflow artifacts
and external archival workspace. The official asset manifest is retained.
GitHub's artifact retention is 14 days, so omitted payloads are not guaranteed
permanent by this compact Git archive.

The separate `Validate SharpForge` run 37225007376 failed A00 tests. It checked out
PR merge commit `4802e7382be0784164fdc8d1b71a6bbfc92fe192`, tree
`90a9350e1a692628dd9dfbc0f2c4e382588907c4`, against newer main `75f0caad…`.
That different tree is not the product tree qualified by these focused push jobs.
The successful observations here do not turn the repository-wide core failure,
pending standard native cells, or explicitly unsupported native policies into passes.
