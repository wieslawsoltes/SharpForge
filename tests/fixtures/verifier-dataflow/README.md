# Bounded verifier dataflow qualification

Product `a1263d5ae42eb95d0c64891f8e39b6c521ea245b`, compared with integrated
base `bf5ed78110a864d9771849ac7845f0139d1986c4`. The source implementation is
unchanged since the completed run. Scope: decoded basic blocks, bounded queue,
changed-state reprocessing, handler seeds, leave clearing and execution-profile
height policy. Internal typed-state tests reuse the existing verification lattice;
these do not establish typed opcode verification.

The one serial driver used a machine-wide slot, one test file at a time and a
1 GiB Node heap. Node 24.21.0, macOS 26.6 arm64, Apple M3 Pro, shared machine.
Initial setup selected Node 16 and then lacked explicit verifier paths. Both
stopped preflight logs are retained; no native/product test failed or was weakened.
The supported Node 24 installs and expected-before proof were then run once.
The old product incorrectly granted a stack proof with maxDataflowSteps=0.

- Ten emitted PE cases agree with pinned ILVerify 10.0.5, SDK 10.0.201/runtime
  10.0.5: empty/balanced stacks, underflow, maxstack overflow, mismatched join,
  diamond, loop, repeated switch targets, catch and finally. Every negative
  includes its expected ILVerify category. Source/assembly/tool hashes are retained.
- Ten focused and compatibility files: **158 passed, zero failures/skips**.
- Twelve admission/execution/budget/cancellation cases passed in each of
  Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 using HTTP source modules
  with CSP. All browser/server handles closed. The retained launcher derives
  from the existing inspector launcher by changing only module path/run labels;
  original and derived hashes are recorded.
- Static: 3,574 syntax modules / 3,570 import modules, zero errors. Manifests:
  966 Node files, 37 browser scripts, 30 areas, no unassigned or duplicate files.
- Structure: 271 existing findings. No new source finding; execution-profile
  shrinks from 9,890 to 9,803 bytes and 104 to 103 lines, retaining its existing
  466-character maximum line. Per-file proof is in qualification/summary.json.

## Existing admission controls

Milliseconds per 1,000 admissions. Fixed baseline then candidate, twelve
chronological samples each for three controls; first three were predetermined
warmups, median/p95 use the remaining nine. All **72 raw samples** remain in
qualification/baseline.json and candidate.json. Fixture hashes match. No rerun
or omitted sample, and no attribution to noise or causation.

| Control | Before median / p95 | After median / p95 | Median / p95 change |
| --- | ---: | ---: | ---: |
| No handlers | 3.781958 / 4.211041 | 4.249208 / 6.033959 | +12.355% / +43.289% |
| Catch | 8.192417 / 10.966708 | 8.794375 / 10.874291 | +7.348% / -0.843% |
| Finally | 6.859208 / 9.133875 | 7.107750 / 9.802584 | +3.623% / +7.321% |

**Explicit root integration sign-off:** accept the reported increases for the
bounded graph/worklist and convergence checks needed by the verifier. The
no-handler median/p95 increases are +0.467250/+1.822918 ms per 1,000 admissions;
catch median +0.601958 ms; finally p95 +0.668709 ms. The queue has one preallocated
slot per block, merges before scheduling, and reuses decoded IL/offsets. There
is no metadata reread, CFG rebuild per visit or queue pair allocated per edge.
Independent read-only A03 peer review found no major avoidable overhead or
correctness blocker and supported this narrow acceptance. These measurements
do not establish a speedup, peak-memory reduction or broader engine performance.

## Reproduction and limits

Inside the reserved serial slot, explicitly select Node 24 and set
SHARPFORGE_ILASM, SHARPFORGE_ILVERIFY and SHARPFORGE_ORACLE_DOTNET to the pinned
provisioned tools. The retained driver records every command and source/input
hash; its absolute temporary paths identify this actual run. Core commands:

```
node tests/fixtures/verifier-dataflow/capture.mjs OUTPUT.json
node --test --test-concurrency=1 tests/a03-verifier-dataflow.test.js
node packages/cil/tools/benchmark-handler-entry.mjs OUTPUT.json
```

The diagnostic spellings follow the pinned [ILVerify 10.0.5 catalog](https://raw.githubusercontent.com/dotnet/runtime/v10.0.5/src/coreclr/tools/ILVerification/VerifierError.cs).
Full typed transfers, definite initialization, filter execution, full CLR
verification and wider platform/Rust/Wasm qualification remain open under
#2401 and the other SF-A03-T07 tasks. No unsupported target is reported passing.
