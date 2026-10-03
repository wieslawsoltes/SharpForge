# Native platform qualification

Task SF-A29-T10 (#406), leaves #1180–#1184. The implemented harness targets
Windows, Linux and macOS on x64 and arm64. Each SDK runs independently, as does
each Node version. No simulator or browser VM supplies a native observation.

**Execution is deferred.** This scope was implemented under the user's direction
to batch validation after larger epics. No local tests, native captures, latency
measurements or hosted qualification have been run for this implementation. The
committed [platform matrix](../platform-matrix.json) therefore contains sixty
unknown obligations and zero tested OS versions. Earlier oracle/CI observations
are not silently imported into this different scope.

## Exact targets and contracts

[toolchain.json](toolchain.json) pins Node 22.23.3 (the supported minimum major)
and 26.10.0 (the current release line reviewed on 2026-10-03), with their bundled
npm versions. Node's [official release index](https://nodejs.org/dist/index.json)
is the provenance source. This does not change the Node 24.21.0/npm 11.19.0
reproducible artifact producer pin.

.NET 8 uses SDK 8.0.425/runtime 8.0.31 from Microsoft's
[release metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json).
.NET 10 reuses the oracle's SDK 10.0.201/runtime 10.0.5 pin. A temporary
`global.json` disables SDK roll-forward; runtime configs disable runtime
roll-forward. The actual SDK-compiled process reports its runtime and process
architecture before either native engine can qualify. An emulated x64 process
on an arm64 runner cannot qualify an arm64 cell.

| Target | Requested runner | Initial qualification |
| --- | --- | --- |
| Linux x64 | ubuntu-24.04 | Unknown |
| Linux arm64 | ubuntu-24.04-arm | Unknown |
| Windows x64 | windows-2025 | Unknown |
| Windows arm64 | windows-11-arm | Unknown |
| macOS x64 | macos-15-intel | Unknown |
| macOS arm64 | macos-26 | Unknown |

These labels are documented by [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
They request environments; they are not evidence that those environments have
passed. Every actual observation records OS release, image/version, architecture,
Node/npm, installed SDKs and exact commit in `env.json`. Other OS/image versions
remain separately labelled inferred. Browser native processes and other
architectures are outside this harness and explicitly unsupported.

## API capability rows

| Capability ID | Leaf | Existing API exercised | Positive, negative and boundary fixtures |
| --- | --- | --- | --- |
| platform.native-il | SF-A29-T10.1 | `compileToIL`, `createRuntimeConfig`, actual CoreCLR process | Existing CLR/CIL corpus, exact stdout and OS exit representation, numeric boundaries, malformed image |
| platform.native-msbuild | SF-A29-T10.1 | `NativeWorkspace`, `NativeMSBuild.start/wait/cancel/close/artifact` | SDK build and CLR execution, queries/preprocess/targets, incremental copy, actual error diagnostic, malformed project/path, cancellation with native grandchildren, output limit |
| platform.node-core | SF-A29-T10.2 | Package engine `>=22`; actual npm check/test/build | Exact Node/npm identity, full core commands, stable gap IDs for divergence; no engine result inferred from the other version |
| platform.filesystem | SF-A29-T10.3 | CLI `writePlan`, `NativeWorkspace.open/read/save/scan` | Actual case/Unicode volume identity, symlinked temporary parents, rejected interior links, long paths, Windows names, CRLF/BOM bytes, malformed UTF-8, file/byte limits and stale-write conflict |
| platform.process | SF-A29-T10.4 | Actual CLI process and `startMSBuildHost` loopback socket | Exit 0/1/42, malformed input, real POSIX or Windows ACL denial, token/Origin/Host checks, closed socket, signal disposal and child-tree cleanup |

The contract revision is `sharpforge-native-platform-v1`. Matrix rows bind the
capability, leaf, exact tool version, platform and architecture. Row IDs and gap
IDs are deterministic. Matrix parsing requires the exact check identities for a
passing capability; a generic passing test cannot qualify another target.

Windows has no POSIX SIGTERM delivery, so that specific check is unsupported with
a reason; actual Windows tree termination is tested separately. A root POSIX
process cannot qualify discretionary read-only permissions and records that
check unsupported. A passing row means all applicable checks passed; its
unsupported sub-capabilities remain attached and do not become passing proofs.
Missing SDKs, setup failures, wrong architectures and runtime mismatches fail.

## Runnable example and staged commands

The [native fixture](../../../tests/conformance/native/fixtures/NativeProbe.cs)
is a small real C# application: it reports runtime/architecture, writes Unicode,
measures managed allocation bytes and supplies cancellable child processes.
The harness copies and builds it in a disposable SDK workspace. Use a clean
committed checkout with the selected exact Node/npm and SDK installed:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/conformance/native/qualify.js --suite sdk --version 10.0.201
node scripts/conformance/native/qualify.js --suite host --version 22.23.3 --core
node scripts/conformance/native/qualify.js --suite sdk --version 8.0.425 --measure
node scripts/conformance/native/matrix-report.js --input artifacts/results/native
```

Run each command on its actual target; a local capture has `runKind: local` and no
fabricated GitHub run ID. The matrix cannot satisfy a hosted run with a local
capture. Partial aggregation retains unknown rows and exits nonzero. On a hosted
run the aggregator requires the current commit and run ID, rejects duplicate
cells, and checks the bundle/`env.json` hashes before recording any observation.

The new `native.yml` workflow has twelve SDK cells and twelve independent Node
cells. Node cells run the core check/test/build plus filesystem/process probes.
It is available on manual dispatch and explicit reusable calls. SDK and Node
cells execute serially; no PR/main/scheduled event starts this specialized workflow. Ordinary PRs keep the existing
single core job. No edits to shared `ci.yml`, release or publish workflows were
needed. Final steps retain environment evidence even if dependency/SDK setup
fails, upload reports, and reject tracked output mutations without restoring
files. No release, deployment or issue completion is performed.

## Measurements and evidence interpretation

With `--measure`, correctness-gated fixtures capture one cold and twenty warm
samples, raw timings and nearest-rank p95/p99. Native CLR allocations use
`GC.GetAllocatedBytesForCurrentThread`; repeated processes include startup and do
not pretend to reuse a JIT. MSBuild repeatedly starts a real no-op target with
node reuse disabled. Its allocation count remains unknown without a profiler.
Host probes measure actual workspace reads and CLI checks; recorded Node heap
deltas are labelled retained-heap changes, never allocation counts.

Results include exact command arrays, stdout/stderr or MSBuild diagnostics,
commit, run ID/attempt and independent status per cell. `bundle.json` binds the
complete report and environment bytes. Clean source is required before and after
capture. Temporary roots use the T09 service; ordinary process probes reuse its
tree cancellation, and single native executions reuse the pinned oracle process
service. Product workspace/MSBuild services are exercised directly, not copied.

Parser regression fixtures are constructed data and explicitly not native
evidence. Neither passing parser tests nor the existence of this workflow changes
the committed unknown matrix into a parity claim. Review real captures before
updating `planning/qualification/platform-matrix.json`:

```sh
node scripts/conformance/native/matrix-report.js --input artifacts/native-downloads --commit EXACT_SHA --run-id ACTUAL_RUN_ID --output planning/qualification/platform-matrix.json
```

The initial empty matrix can be regenerated with `--empty` and the same output
argument. Do not use it to erase reviewed observations. All final-head checks,
native executions, permissions on each OS, cancellation cleanup, allocation and
latency measurements remain staged for the later integrated qualification batch.
