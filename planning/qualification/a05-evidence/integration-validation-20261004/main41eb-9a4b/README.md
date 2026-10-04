# Main41eb merge validation at 9a4b

Both archived commands failed. The focused cohort ran **239 tests: 232 passed,
7 failed, 0 skipped**. All **nine actual SDK10 native cases passed** within that
cohort. The static command reported zero syntax errors, then failed its
dynamic-code gate. These are separate observations, not an aggregate pass.

The tested commit was `9a4b0aef663ee78ab8da487eb90e1cb11c911c9a`, with tree
`4d0164eaecb6a6ccf9bd5e6762fcdea17761f0b0`. Both original execution records report
this same clean identity before and after the command. The working directory
was `/tmp/a05-integration-42f7738360b9`; paths in the raw output retain that
location. The archive adds documentation only and does not claim its own
commit was tested.

## Preserved execution

The four raw files are unmodified byte copies from
`/workspace/scratch/42f7738360b9/a05-main41eb-validation-20261004/`.
[manifest.json](manifest.json) records each source path, byte count and SHA-256,
the tested package/app/script/test trees, and Git blob/SHA-256 identities for
all 34 selected test files plus the native toolchain helper and limiter.

| Command record | Raw output | Exit | Duration |
|---|---|---:|---|
| [Focused execution JSON](focused-merge-9a4b-execution.json) | [Original TAP](focused-merge-9a4b.log) | 1 | 50.769780854 s reported test time; 50.92452650099585 s wall |
| [Static execution JSON](static-9a4b-execution.json) | [Original check output](static-9a4b.log) | 1 | 7.951697065996996 s wall |

The execution JSON files preserve the complete ordered argument arrays,
timestamps, resources, selected toolchain environment and identities. The
focused command invokes `scripts/limited.js`, then Node with `--expose-gc`,
`--test`, `--test-concurrency=1` and `--test-reporter=tap` over the 34 explicit
files. The static command invokes the same limiter around `npm run check`.
Both records report Node `v24.19.0`, one parallel run, one concurrent test file,
and a 512 MiB V8 cap. Outer `NODE_OPTIONS` was unset; native-test diagnostics
confirm the limiter supplied `--max-old-space-size=512` to the child.

## Focused failures retained

The first three rows are the Control repair groups. Their four failed tests,
the two source cleanup failures, and the one file-level input failure account
for all seven failures. Test numbers are the original TAP numbers; the final
file-level failure uses its own file-run number.

| Group | Test(s) | Observed failure |
|---|---|---|
| Exact async type identity | 43, `a05-29-async.test.js` | `TaskAwaiter.OnCompleted` fixture rejected at `Program::Main IL_6`: incompatible async ABI runtime type identity. |
| Open generic builder admission | 174 and 176, `a05-roslyn-async-admission.test.js` | ``AsyncTaskMethodBuilder`1<!!0>::Start`` rejected as unimplemented; both verifier and retained SDK8 snapshot/replay cases fail. |
| Intrinsic handler coverage | 177, `a05-seams-cil-intrinsics.test.js` | `Task.get_IsCompleted` selects an async status definition where the seam assertion expects the reference-equal platform definition. |
| Source async-stream cleanup | 228, `compiler-lowering-async-streams.test.js` | Faulted await-using trace omits `plain` and `close first` before `failed`. |
| Source async cleanup | 233, `compiler-lowering-async.test.js` | Faulted catch trace omits `finally` before `outer failed`. |
| Missing local supply input | File 34, `conformance/supply/gates.test.js` | `ENOENT` for `planning/qualification/supply/public-fixtures.json` aborts the test file. The supply assertions did not pass. |

These rows describe the observed failures without waiving assertions or
claiming a root cause has been repaired. The raw output retains the exact
expected/actual values, diagnostics and stack traces.

## Native subset

Tests 53–61 in `a05-cil-async-native.test.js` all passed without skips. Six
compare direct CIL execution against freshly compiled and executed native
fixtures: Completed, Suspended, Exceptions, Retention, WaitAndDelay and
Mutation. Two check Retention/Mutation snapshots, collection and exactly-once
continuations. The ninth compiles real Roslyn output, corrupts `MoveNext` and
checks rejection before guest execution. The positive cases exercise both
compiler optimization modes; the corruption case builds the unoptimized
fixture.

The diagnostics identify SDK **10.0.201**, C# language version **12**, framework
**net10.0**, and reference pack **10.0.5** with **167 reference assemblies**.
The runtime configuration requests Microsoft.NETCore.App **10.0.0**. As the
diagnostics explicitly state, the executed runtime patch was **not independently
probed**. These passing current SDK10 cases do not replace the two failed
retained SDK8 regression cases or qualify every native/platform axis.

## Static failure retained

Manifest registration reported 30 areas, 1,347 Node files, 38 browser scripts,
zero unassigned files and zero duplicate owners. Syntax checking reported
**4,800 modules and zero syntax errors**. The subsequent dynamic-code gate
reported `passed: false`, 4,744 inspected files, 4,791 modules and five errors:

- Three archived `.mjs` files under `planning/qualification/a05-evidence/`
  resolved an obsolete `a05-numeric-qualification` path and failed with `ENOENT`.
- `planning/qualification/integration-performance/size/measure.mjs` produced
  both a changed/unreviewed dynamic-import diagnostic and a stale/mismatched
  allow-list diagnostic. Its reported SHA-256 is
  `431b55d1751c5fda710454c45a02ef31fb594d029cff12d17cb371072ff819f3`,
  corresponding to the intentional nested-worker measurement correction.

No gate is disabled by this archive. It records neither a successful static
check nor a complete A05, browser, performance, size or platform qualification.
No test, build or measurement was rerun while preparing the archive. The raw
TAP retains eight whitespace-only diagnostic lines reported by `git diff
--check`; they are preserved to keep the original bytes and digest unchanged.
