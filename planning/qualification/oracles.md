# Pinned native reference oracles

This harness supplies independent reference evidence for A29 T02 (#398,
#1121–#1124). It executes Microsoft's Roslyn, CoreCLR/BCL and WinUI binaries.
It does not call SharpForge's compiler or interpreter and does not establish
SharpForge parity by itself. Consumers must compare their implementation with
these observations and record their own capability evidence.

The exact toolchain is [oracle-toolchain.json](oracle-toolchain.json): SDK
10.0.201, CoreCLR/reference pack 10.0.5, SDK Roslyn
5.3.0-2.26153.122 (commit 4d3023de605a78ba3e59e50c657eed70f125c68a),
Windows App SDK 1.8.260921001 and Windows SDK .NET Ref 10.0.19041.57.
`global.json` disables SDK roll-forward. Compiler DLL and reference-assembly
hashes are checked before any fixture runs. Each executable disables runtime
roll-forward; the runtime-version fixture independently asserts `Environment.Version`.

Linux uses Microsoft's SDK container by immutable multi-architecture digest.
Windows and macOS hosted labels cannot select an old image build, so the harness
checks the exact `ImageOS` and `ImageVersion` pins and fails on image drift.
Refreshing a platform pin requires review and native recapture. Local OS versions
are reported as local/unpinned; a local run is not evidence of a pinned VM image.
The checked scope is Linux x64, Windows x64 and macOS arm64. Other architectures
are explicitly unsupported by this harness version, even where .NET itself runs.

## Runnable example

Install the pinned .NET SDK, then use Node 22 or newer from the repository root:

```sh
node --test tests/conformance/oracle/*.test.js
node scripts/conformance/oracle/qualify.js --verify
node scripts/conformance/oracle/verify-expected.js
```

`--oracle roslyn`, `--oracle coreclr` and `--oracle winui` independently select an
oracle (CoreCLR still compiles with Roslyn). The default is all. The
`hello-unicode` fixture is a complete example: its source is compiled twice with
LangVersion 12.0, both assembly hashes must match, then two native CLR processes
must emit `Oracle 42 → café` identically. Compilation uses the SDK's `csc.dll`
and exact reference-pack DLLs, rather than a NuGet compiler floating independently
of the SDK. The SDK-only project has an intentionally empty NuGet dependency
lock; its locked restore is still checked. WinUI has a full transitive NuGet lock
with package content hashes and one allowed source, nuget.org.

`--capture` produces candidates without baseline qualification and labels the
report `captured-not-baseline-qualified`. `--update` explicitly regenerates
tracked expected outputs only after the double-run and fixture correctness gates
pass. The default `--verify` writes candidates into ignored artifacts, compares
them with committed expected outputs, and fails if any baseline is missing or
different. Never copy candidates from a failing fixture, changed toolchain or
unreviewed source into the expected store. No command restores tracked files to
hide mutations. Build/restore happens in disposable temporary directories.

## Expected-output contract

The store format is [expected.schema.json](expected.schema.json), under
`tests/conformance/expected/<oracle>/<encoded-tool-version>/<target>/<input-hash>.json`.
Roslyn's deterministic IL and diagnostic spans are platform independent (`any`);
native process results retain OS-specific stdout line endings, exit statuses and
signals under their actual platform. A Windows negative return value is captured
as the actual unsigned DWORD, while POSIX exposes its low byte. Unhandled CLR
exceptions retain raw stderr plus the independently parsed exception type.

The fixture hash covers source filename, raw source SHA-256, LangVersion and all
semantic compiler options. Compiler/runtime versions are separate required keys.
The verifier recomputes hashes from the current source, validates strict schema
fields and oracle result shapes, and rejects unknown fixtures, stale source/tool
versions, wrong language versions and path/key mismatches. WinUI's input hash
covers its source, project, manifest and restored NuGet lock. No timestamp, temp
directory, elapsed time or machine path appears in expected records.

## Native WinUI qualification

On Windows x64 (build 19041 or newer), `winui-run.js` restores with `--locked-mode`,
builds the actual C# WinUI host and launches it twice on an interactive desktop.
Windows App SDK is deployed self-contained next to the unpackaged executable;
.NET remains framework-dependent on the exact pinned CoreCLR. The host initializes
WinRT wrappers and `Microsoft.UI.Xaml.Application`, creates real `Button`,
`StackPanel` and `Window` objects, exercises dependency-property local/clear/zero
behavior, rejects negative Width and malformed XAML, tests child add/remove,
checks dispatcher FIFO and UI thread access, cancels a queued operation and
closes the window. It records native exception types for the negative cases.

Windows build/deployment/desktop failures fail the oracle and include their
diagnostics; Windows is never silently marked unsupported. Linux and macOS
explicitly report native WinUI unsupported. A browser DOM, mocked dispatcher or
portable reimplementation cannot satisfy this oracle. This parent remains
unqualified until the real Windows host has run and its expected outputs have
been reviewed and committed.

## Capability inventory and measurements

| Capability ID | Reference API/contract | Regression and boundary coverage | Targets |
| --- | --- | --- | --- |
| `oracle.roslyn.compile` | SDK `csc.dll`, C# 11/12, SARIF 2.1 diagnostics | Unicode success, syntax/type errors, C# 12 collection-expression boundary; deterministic PE hash | Linux x64, Windows x64, macOS arm64 |
| `oracle.coreclr.execute` | CoreCLR 10.0.5 native process | runtime version, stdout/exit, Int32 boundaries, negative exit, unhandled exception, nondeterminism rejection | Linux x64, Windows x64, macOS arm64 |
| `oracle.bcl.collections-cancellation` | .NET 10 BCL | collections, invariant formatting, JSON, cancelled Task, IDisposable cleanup | Linux x64, Windows x64, macOS arm64 |
| `oracle.winui.controls-dispatcher` | Windows App SDK 1.8.260921001 | native control/property/children/dispatcher, invalid values/XAML, cancellation/window disposal | Windows x64; explicitly unsupported elsewhere |
| `oracle.expected-store` | Expected-output schema v1 | source/tool drift, malformed fields, wrong result/path, byte-identical regeneration | Node host, independent of target runtime |

Each report contains the exact Git commit, native command arrays, observed tool
versions/hashes, OS/image metadata, unsupported records and per-run timings.
`artifacts/results/oracles/<platform>/oracle-toolchain.json` is uploaded even if
tool resolution fails. `report.json` and candidate expected records are always
uploaded by the isolated `oracles.yml` workflow.

The CoreCLR benchmark executes a correctness-checked allocation fixture once cold
and twenty more times, reporting p95/p99 startup/execute latency and actual managed
allocation bytes through `GC.GetAllocatedBytesForCurrentThread`. Every sample is
a fresh CLR process: warm means repeated filesystem/runtime startup, not a reused
JIT. Roslyn reports first/repeated process timings; native compiler allocations
are not measured. WinUI records startup time, twenty warm native control timings
and managed UI-thread allocations; these exclude native UI/runtime allocations.
Timing/allocation data is separate from deterministic expected outputs.

## Sources and licenses

Use of Microsoft's SDK/runtime packages is subject to their package licenses;
the manifest links those licenses. WinUI packages are fetched through NuGet's
locked content hashes. Reference behavior follows Microsoft's
[SDK selection rules](https://learn.microsoft.com/en-us/dotnet/core/tools/global-json),
[deterministic compiler output](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/code-generation#deterministic),
[SARIF error logs](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/errors-warnings#errorlog),
[NuGet locked restore](https://learn.microsoft.com/en-us/nuget/consume-packages/package-references-in-project-files#locking-dependencies),
and [Windows App SDK self-contained deployment](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/self-contained-deploy/deploy-self-contained-apps).
