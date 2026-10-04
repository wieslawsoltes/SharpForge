# Numeric verifier qualification

Qualified product `f9d00bdcddd2f5804cc0469a0353b14daf5f879a`, parent
`b0dff7f7738c78b34c113514cf38790e2f5ed71d`. Source stayed frozen during the
final run. Candidate and detached parent installed independently; each resolved
its own CIL workspace. Exact source, fixture and dependency-link proofs, commands,
all chronological logs and browser driver provenance are retained in `qualification/`.

The isolated parent retained the height-only int32 + float acceptance and failed
the missing typed-API assertion as expected. This demonstrates an added capability;
it does not claim the existing execution-height API changed.

Pinned ILVerify 10.0.5 / SDK 10.0.201 / CoreCLR 10.0.5 captured all **77** authored
images. All actual results match the expectations declared before capture, with
**eight explicitly retained disagreements with ECMA**: two int64/native-int
arithmetic cases, asymmetric int32/int64 comparison, same-type object ordering,
three int32/native-int assignments/returns, and a mixed join. Product follows ECMA;
these differences are not native parity passes. Full #2402/#52 acceptance remains
open. Input/native PE hashes and complete tool output are in `native.json`.

Final focused tests passed **27/27**. The initial run passed 26/27: the malformed
unreachable-branch regression expected the new solver diagnostic, but the existing
byte decoder already rejected it earlier. The duplicate scan was removed, and the
regression now asserts the decoder rejection category, message and offset. Both
logs are retained; malformed IL remains rejected. Native input was unchanged and
its capture was reused; no performance samples had run before this correction.

Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 each passed **80** checks under
HTTP source-module import maps and CSP. Browsers and server closed. These checks
verify the typed API; they do not execute IL. Broader source-VM/direct-CIL/native/
Wasm execution admission remains outside this partial profile.

Syntax: 3,599 modules, zero errors. Static imports: 3,595, zero errors. Manifests:
30 areas, 975 Node files, 37 browser scripts, no unassigned/duplicate files.
Structure: 271 inherited findings and none in changed files.

## Fixed performance capture

Shared Apple M3 Pro, Darwin 25.6.0, Node 24.21.0; one team validation job, one Node
worker, 1 GiB heap cap. Each workload used 12 chronological samples of 1,000
operations; the first three are warmup and all remaining nine determine median/p95.
All **108** raw samples and new-workload heap deltas are retained. No repeats,
speedup claim, causal/noise attribution, peak-memory or allocation-count claim.

Existing height-admission controls, milliseconds per 1,000:

| Control | Median before → after | p95 before → after |
| --- | --- | --- |
| No handlers | 4.565667 → 4.592917 (+0.60%) | 5.554584 → 7.318875 (+31.76%) |
| Catch | 9.510292 → 11.963041 (+25.79%) | 12.812750 → 22.820000 (+78.10%) |
| Finally | 8.074958 → 9.650375 (+19.51%) | 10.605708 → 21.441500 (+102.17%) |

The Project6 integrator explicitly accepts these over-budget observations for this
batch. The largest absolute increase is **10.835792 microseconds per admission**
at p95; largest median increase is 2.452749 microseconds. Exact diffs prove the
existing execution-profile, height transfer, dataflow graph/solver and control
fixture/benchmark source unchanged. This is a code fact, not a causal explanation
for the measurements. The added bounded typed API closes a real type-confusion
inspection gap; this sign-off does not establish an isolated regression cause or
waive future performance requirements.

Added typed workloads (no prior equivalent API), milliseconds per 1,000:
addition median/p95 1.981875/2.645500; diamond 2.325584/3.051083;
rejected mixed join 13.126833/14.230291. These are capability costs, not speedups.

Reproduction commands and exact serial order are archived in `qualification/driver.mjs.txt`.
The browser driver is `qualification/browser.py.txt`. The pinned native capture is:

```sh
node tests/fixtures/verifier-numeric/capture.mjs tests/fixtures/verifier-numeric/native.json
node --test --test-concurrency=1 tests/a03-numeric-transfers.test.js tests/a03-verifier-dataflow.test.js tests/a03-verification-types.test.js
node packages/cil/tools/benchmark-handler-entry.mjs <existing-control.json>
node packages/cil/tools/benchmark-numeric-verifier.mjs <new-capability.json>
npm run check
npm run check:structure
```

Run each command sequentially through `scripts/limited.js`; native tool paths and
other exact environment values are recorded in the serial driver and raw captures.
Ordinary automatic PR core is separate and is not unit/native/browser qualification.
