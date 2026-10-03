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
node --test tests/conformance/oracle/*.test.js tests/conformance/oracle/*.native.js
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
Every observation retains its actual platform. Roslyn's deterministic PE bytes
are stable on each pinned host but differ between Windows and Unix SDK builds;
they are never normalized into a shared binary baseline. Native process results
retain OS-specific stdout line endings, exit statuses and signals. A Windows negative return value is captured
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

## Recorded qualification

Implementation commit `8552b2798dc7ed01570e547879f68471f7cef712` was qualified
from a clean checkout on macOS arm64, Darwin 25.6.0, Node v24.21.0 with the exact
pinned SDK/compiler/runtime/reference hashes. Commands:

```sh
node --test --test-reporter=tap tests/conformance/oracle/*.test.js
node scripts/conformance/oracle/qualify.js --verify
node scripts/conformance/oracle/verify-expected.js
node scripts/conformance/clean-checkout.js
```

All 12 regression tests passed. All 11 Roslyn and 8 CoreCLR observations passed;
the 19 expected JSON files reproduced byte-for-byte on a second native run.
WinUI was explicitly unsupported on this host. The restored WinUI C# source also
compiled with the actual WinUI/WinRT reference DLLs, which verifies managed type
binding only and is not native WinUI execution qualification. Actionlint 1.7.8
accepted the isolated workflow. No root package registration or product runtime
was changed.

The committed-run report is at
`artifacts/results/oracles/darwin-arm64/report.json`, SHA-256
`70b21599f70779e32c09151e690de05e2894299123ef1cdd21e1be748addfe84`.
It records `dirty: false`. Measured CoreCLR cold process latency was 33.90 ms;
repeated-process p95/p99 were 34.43/49.35 ms. Each allocation sample measured
152,000 managed bytes with the fixture correctness gate passing. These are local
observations, not performance budgets or a claim about other machines.

Hosted Linux/Windows CoreCLR expected outputs and native WinUI execution remain
pending. Their first verification uploads actual candidates while failing on
missing baselines. The parent task must stay open until those outputs have been
reviewed, committed, and passed in the independently pinned hosted jobs.

The first hosted run identified platform-specific Roslyn executable bytes and
container Git ownership checks. Compiler hashes are now pinned per runtime
identifier. The Linux x64 and Windows x64 SDK archives were downloaded from
Microsoft's release metadata URLs and their complete SHA-512 hashes verified
before hashing `csc.dll`; the source URLs and hashes are retained in the toolchain
manifest. All three SDKs contain the same 167 reference-assembly hashes. Linux's
compiler version was also checked with ReadyToRun disabled on the local managed
host; that is a compiler identity check, not native Linux execution qualification.
The pinned container explicitly trusts its mounted Git checkout. Pin failures
retain actual compiler/reference metadata in the failure report.

Generic Node CI runs the nine host-only oracle tests. The three tests requiring
the pinned SDK are in `oracle.native.js` and run explicitly in every oracle
workflow job, with no fallback to another SDK and no passing skip. The complete
12-test batch passes locally after these portability fixes; hosted execution and
platform expected-store review remain required.

The next hosted run (37127555102, clean merge commit
`413d89b7da493a1657c634c60ab840ad4bbf3360`) verified all three platform pins.
Linux passed all 12 regression tests and produced 19 observations; Windows
produced 17 accepted non-Unicode observations, while the Unicode fixture
revealed its dependence on the console code page. Reviewed non-Unicode native
results are now committed separately for Linux and Windows. The Unicode source
has an explicit UTF-8 BOM and sets UTF-8 output encoding, so its new source hash
requires fresh observations on both hosts. Windows Roslyn PE hashes are kept
exactly as observed. The WinUI compatibility manifest now places
`maxversiontested` in the compatibility namespace with its required `Id`
attribute. A failed native launch retains the built host and structured process
error for diagnosis. Windows WinUI execution and the refreshed Unicode baselines
remain pending; no failed observation was promoted.

Hosted run [37128462298](https://github.com/wieslawsoltes/SharpForge/actions/runs/37128462298)
ran clean merge commit `3306de923331b9166984f0156e78f568e67c441f`. All
12 regression tests passed on each host. Linux recorded 19 observations and
Windows recorded 20, including two matching executions of the actual WinUI
controls/dispatcher host. Unicode stdout is exact UTF-8 with native LF/CRLF
retained. WinUI measured cleared/local dependency properties, negative Width
ArgumentException, malformed XAML XamlParseException, child removal, dispatcher
order [1,2], cancelled work remaining unexecuted, and window closure. The only
qualification failures were the five missing refreshed baselines; their reviewed
actual bytes are now committed. The next native run must compare these committed
records successfully before this scope is marked qualified.

All three native jobs passed in
[37128733246](https://github.com/wieslawsoltes/SharpForge/actions/runs/37128733246),
qualifying branch commit `2e9357a469e38fdec920d6efeb2014cd9a30e382` against the
committed baselines. Linux x64 and macOS arm64 each verified 19 observations;
Windows x64 verified 20 including real WinUI. Each platform passed the 12-test
regression batch and clean-checkout check. The expected store now has 58 native
records across the three pinned platforms. This qualifies the reference harness,
not SharpForge feature parity.

Ordinary pull requests run the shared core check only. Native reference jobs run only by explicit manual dispatch, serially across
platforms, following the [validation schedule](serial-validation.md).
