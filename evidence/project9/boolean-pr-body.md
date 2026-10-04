Task: SF-A07-T21

Area: A07
Lock keys: none

The path audit found zero changed protected paths and verified that all 60 checked
hot/index paths are unchanged. This audit does not establish task ownership.

## Delivered behavior

Adds the genuine public static readonly string fields `System.Boolean.TrueString`
and `FalseString`, yielding `"True"` and `"False"`, through the existing external
readonly-field contract. This is a prerequisite for #783; **#783 remains open**
for Boolean methods and the broader Object/ValueType acceptance. No getter,
language constant, or method contract ID is introduced.

- Bound/full-semantic/legacy source lowering preserves real field symbols and
  canonical owner provenance. Source loads use the closed
  `{readonlyField:{owner,name}}` carrier; canonical emission and independent CIL
  use genuine `ldsfld` field references. Compiler initializers execute a load;
  raw carriers in static defaults are rejected at VM construction/emission.
- Admission checks exact raw owner shape, field name, primitive string signature,
  static operation, approved `System.Runtime`/`System.Private.CoreLib` signing
  identity and neutral culture. Metadata versions are preserved but deliberately
  excluded from facade compatibility matching. Lookalike scopes, substituted
  signatures, writes and managed addresses fail; local fields keep local storage.
- Lazy per-VM initialization roots fields in existing snapshotted constant/static
  stores while ordinary weak literals stay weak. Both observer nesting directions
  preserve field/literal identity through canonical rechecks. Pending operations
  are bounded, same-key reentry is sticky, and cleanup permits retry after failure.
- Allocation-observer GC, throw, reentry and explicit stop are covered. Snapshot
  and restore are rejected inside unfinished initialization; between-call restore
  remains valid. Explicit stop prevents publication and pushes to retired stacks;
  natural Main completion still permits host reads. These are SharpForge host
  policies, separately tested from native CLR observations.

The implementation reuses existing field descriptors, static slots, precise roots,
snapshots and synchronous callback boundaries. The corrective hot-path commit
returns cached source values and current-pool literal hits before repeated
classification/transient pool construction, retaining every cold safety check.

## Ownership and dependencies

- Related existing leaf: #783 / SF-A07-T21; branch
  `codex/a07-boolean-string-fields`. Claim/lease evidence:
  No current `agent/SF-A07-T21` ref was found in fresh authoritative reads; #783 carries the `state:blocked` label. Its Project Agent and Lease fields were not observed. No lease or Ready status is claimed. Ownership/readiness reconciliation is required before promotion; see the retained [claim and readiness evidence](https://github.com/wieslawsoltes/SharpForge/tree/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/blocked-prerequisites). Exact changed paths/lock mapping:
  [47-file mapping and preserved protected paths](https://github.com/wieslawsoltes/SharpForge/tree/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/blocked-prerequisites).
- Integrated branch and measurement baseline:
  `af5450dacbdc2734432b13dffa63efb10eb93145`. Merged prerequisites include genuine
  scalar readonly fields, Stopwatch, callback/lifecycle guards and allocation
  observer roots. Main has advanced independently; this evidence does **not**
  claim qualification of an integration with current main.
- Changes outside A07 are the necessary framework/compiler/bytecode/CIL/runtime
  field and string-initialization leaves, their focused fixtures, and benchmark
  tooling. Existing protected entry points/VM files and the root dependency lock
  are unchanged. The reserved A00 changes below are **not included**.

**Portable-source contract qualification remains blocked on owner prerequisites.**
The current structural image schema rejects the new object carrier, and its source
typed-body adapter does not lower that carrier. Source serialization/runtime
roundtrips therefore do not establish the complete portable contract.

| Required owner work | Owner / coordination | Prepared proposal |
| --- | --- | --- |
| Structural image schema | `codex-p4-abi`, #1062 | Closed record with nonempty owner/name strings; static defaults remain primitive. Semantic validation owns NUL and UTF-16 limits. |
| Source typed-body adapter | `codex-p4-abi`, #1066 | Validate centrally and lower to existing `load-static`, zero inputs and one `ref:System.String` output. |
| Compatibility gate and tests | `codex-p4-planning`, #1101 / `agent/SF-A00-T10.4` | Narrow additive carrier/items proof; unchanged primitive validation budget; whole-schema reference-context guard. |
| Public bytecode facade | `codex-p4-services`, #1043: preserved legacy bytecode-index ownership; atomic lock absent, reconciliation still required | Export the existing central validator; no private import or duplicated policy. |

All four patches are unapplied, independently reviewed owner proposals. Live leases
must be rechecked. No opcode/version bump is proposed, contingent on the owners'
actual compatibility qualification. The combined proposal SHA256 is
`61970b65da7d2dbadb166f1c266bd336b258403a83ba17f04a7195aa68658b2e`;
proposal, split hashes and provenance: [Unapplied owner proposals and exact hashes](https://github.com/wieslawsoltes/SharpForge/tree/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/blocked-prerequisites/boolean-a00).

## Evidence

Exact qualified commit: `af29812a6b0ca0184a79cc6bcddd01bf0a02fb6a`.
Exact tree: `d934a12e448fc825ad49a535ced67a801e98e57c`.

The serial Node v24.19.0 / Linux x64 qualification completed:

- **316/316 tests passed** across 18 files; zero failures, cancellations, skips or
  todos. Covers source, canonical reload, independently authored CIL, descriptors,
  exact identities, GC/lifetime, snapshot/reentry/stop, existing scalar/string and
  constructor regressions, and registry/inventory consumers.
- `node scripts/limited.js npm ci --ignore-scripts --no-audit --no-fund` passed;
  root lock SHA256 was unchanged.
- `node scripts/limited.js npm run check` passed: 4,129 syntax modules and
  4,113 imports. `npm run check:structure` through the same wrapper passed in
  warning mode with 268 existing warnings; this is not a strict-clean claim.
- A fresh `node scripts/limited.js npm run build` passed.

Exact test argv, input hashes, environment and command logs are recorded in
`boolean-optimized-qualification.json`. Test TAP SHA256:
`cd4318a9eb90386943ba4331c5054b1ced8d5a115bd6bef3ae01b852e423b92a`.
Immutable qualification/log URLs: [Complete evidence index](https://github.com/wieslawsoltes/SharpForge/tree/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/boolean-qualified) · [Published-commit replay receipt](https://github.com/wieslawsoltes/SharpForge/blob/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/boolean-qualified/boolean-published-replay.json) · [Full 316-test TAP](https://github.com/wieslawsoltes/SharpForge/blob/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/boolean-qualified/boolean-published-replay-tests.tap). The published commit is `d6c6eb24eae3a7116b4bb5497c68b40b90aa3d2c`, with the exact measured tree shown above. A direct replay at that published commit passed 316/316 with zero failures/cancellations/skips/todos; TAP SHA256 `e353db73377e51ac074235d6e3f4ba8d67cc02ea6db68ecf2a35b4b80b060d52`.
PR core and any later integration result: **Passed:** [core run 37222761967](https://github.com/wieslawsoltes/SharpForge/actions/runs/37222761967) completed successfully for published head `d6c6eb24eae3a7116b4bb5497c68b40b90aa3d2c`. GitHub reports the PR can merge cleanly with base `7f4af78df79e3eac36302c50e0a589e0ce9e83ac` (merge ref `9098c7b06992c2b2d8563f5c9f737962a73621bc`). Its `Run npm test` step was skipped by the ordinary core workflow; the separate 316-test published-head replay is linked above. No targeted Node integration replay on the merge ref is claimed. The PR remains a draft for the material A00 contract and ownership prerequisites.

The frozen native reference used SDK 10.0.201 / CoreCLR 10.0.5 on Ubuntu 24.04.3
LTS x64; build had zero warnings/errors. It records genuine field metadata,
defining assembly identity, values/UTF-16 units, literal/intern identity, copies,
collection and four cultures.

| Frozen native artifact | SHA256 |
| --- | --- |
| `Program.cs` | `8cc63fdef39f630d63cb50718c68de43b759004c059ceb2dc08503d0dfb14dc0` |
| `BooleanStringFieldsReference.csproj` | `772eff4e2c0f9b0327bb80d130bf73799ec1f47fb8ff8a7572162535705973d4` |
| `boolean-string-fields-net10.json` | `5155917b117ab8906d00c4863efa0220cd9b0140bd847037418585701dd13d69` |

Native capture/log URLs: [Native source at the published product](https://github.com/wieslawsoltes/SharpForge/tree/d6c6eb24eae3a7116b4bb5497c68b40b90aa3d2c/packages/bcl-core/reference/boolean-string-fields) · [Frozen native capture](https://github.com/wieslawsoltes/SharpForge/blob/d6c6eb24eae3a7116b4bb5497c68b40b90aa3d2c/packages/bcl-core/reference/boolean-string-fields-net10.json). The complete archive also retains native build output and capture provenance.

Performance uses baseline `af5450da` and this exact candidate with identical runner
SHA256 `ba0202edda201ad0755f16e4e30811c90e8b9b5027b940b08819b63ae207c14e`:
five warmups, nine samples, 5,000 iterations, fresh isolated `--engine`/`--case`
processes, serial ABBA controls, and separate new-field samples. The 42-process
cohort covers cold literals, warm literal/static loads, compiled scalar constants,
independent genuine scalar `ldsfld`, and independent CIL `String(char[])` construction.
Loop timing includes interpreter overhead and first initialization; setup,
admission, explicit host GC and result checks are excluded. Automatic GC remains
measured. Compiled `readonlyScalarLoop` is `CONST`/`ldc.i8`, not external `ldsfld`.

- Final machine/sharing disclosure and exact commands: Node v24.19.0, Linux x64, AMD EPYC 9V74 80-Core Processor, shared host with the repository run-slot limiter; no dedicated-host isolation is claimed. Exact 42 argv/configuration/start/end/output hashes are in the archived `boolean-optimized-benchmark-execution.json` and driver. All 40 old-control processes finished before the 2 new-field processes.
- Before/after median, p95 and managed counters for every control; new-field values:


| Engine / control | Median baseline → candidate (ms/5,000) | Change | Observed p95 baseline → candidate (ms) | Change |
| --- | ---: | ---: | ---: | ---: |
| source / literalCold | 8.000348 → 11.427717 | +42.840% | 21.599038 → 13.583818 | -37.109% |
| source / literalLoop | 19.279657 → 20.428899 | +5.961% | 34.858019 → 28.291377 | -18.838% |
| source / staticStringLoop | 19.483108 → 20.378438 | +4.595% | 37.509173 → 30.139647 | -19.647% |
| source / readonlyScalarLoop | 16.371295 → 16.952365 | +3.549% | 33.775608 → 26.735570 | -20.844% |
| cil / literalCold | 12.050075 → 17.622537 | +46.244% | 20.261697 → 28.946798 | +42.865% |
| cil / literalLoop | 110.086243 → 120.176011 | +9.165% | 186.938404 → 205.785115 | +10.082% |
| cil / staticStringLoop | 139.969935 → 107.835983 | -22.958% | 206.781078 → 157.120057 | -24.016% |
| cil / readonlyScalarLoop | 136.227886 → 123.946479 | -9.015% | 173.664641 → 163.679816 | -5.749% |
| cil / stringConstructorLoop | 93.117883 → 90.529650 | -2.780% | 160.925771 → 111.819074 | -30.515% |
| cil / readonlyScalarFieldLoop | 50.234841 → 49.591253 | -1.281% | 69.714677 → 73.050985 | +4.786% |

All existing control source/image/assembly hashes and every managed allocation/byte/collection count match. Host JavaScript allocation is not measured. With 18 pooled samples, nearest-rank p95 is the largest retained observation, not a precise population-tail estimate.

New fields (no baseline equivalent): source median/p95 23.890973/31.434995 ms; CIL 121.243846/178.332950 ms per 5,000 iterations. Both allocate 2 managed strings / 70 bytes with 0 collections.

- Per-control budget exceptions, justification and explicit reviewer sign-off:
  [Independent Codex agent performance sign-off](https://github.com/wieslawsoltes/SharpForge/blob/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/boolean-qualified/boolean-optimized-performance-review.md), with four individually accepted >5% median exceptions: source/CIL cold literals (+3.427368/+5.572462 ms per 5,000) and source/CIL literal loops (+1.149242/+10.089768 ms). The required pending initialization, canonical rechecks, callback boundaries, bounded reentry and explicit-stop guards address demonstrated correctness defects. CIL cold p95 +42.865% and CIL literal-loop p95 +10.082% are explicitly accepted adverse evidence. Whole-workload attribution remains unresolved; the review does not treat tails as noise or offset regressions using other improvements. This is agent review, not human sign-off. The rejected initial cohort remains retained history.
- Fresh baseline/candidate size bytes, percentages and any >10% justification:


| Package | Packed baseline → candidate bytes | Packed growth | Unpacked growth |
| --- | ---: | ---: | ---: |
| @sharpforge/bcl-core | 67,931 → 68,398 | +467 / 0.687462% | +1,379 / 0.549803% |
| @sharpforge/bytecode | 23,795 → 24,274 | +479 / 2.013028% | +1,631 / 1.983075% |
| @sharpforge/cil | 232,083 → 232,882 | +799 / 0.344273% | +2,838 / 0.343556% |
| @sharpforge/compiler | 1,064,667 → 1,064,983 | +316 / 0.029681% | +1,346 / 0.033237% |
| @sharpforge/framework | 22,295 → 22,695 | +400 / 1.794124% | +994 / 1.400651% |
| @sharpforge/runtime | 177,316 → 179,162 | +1,846 / 1.041079% | +6,336 / 1.010523% |

Fresh browser: 112,935,639 bytes / 5,547 files → 112,989,490 bytes / 5,554 files; +53,851 bytes / +0.0476829108%. All six package budgets and browser size accepted in the independent artifact review, with 12 actual tarballs / 2,264 payloads and 11,101 emitted files independently checked. All package manifests are byte-identical across revisions; no >10% exception is needed.

[Independent artifact sign-off](https://github.com/wieslawsoltes/SharpForge/blob/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/boolean-qualified/boolean-final-artifact-review.md).

- Raw samples, artifact identity checks, summaries and size evidence:
  [Full manifest and 4,649,911-byte archive](https://github.com/wieslawsoltes/SharpForge/tree/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/boolean-qualified) (archive SHA256 `6a96a18ec0f827af61caee0cac5afb2feda7ba30ae09eeb9da949b880ec41914`; 272 entries including the manifest), including all initial/rejected and optimized raw reports, both product patches, runners, actual tarballs and complete browser manifests.

Limits: the `mscorlib4` emitter explicitly rejects these field loads because its
token policy cannot provide the admitted facade identity. Source
`new string(new char[0])` remains previously unsupported; constructor cancellation
is qualified with actual independent CIL, without claiming source support.
Browser, SharpForge Rust native/Wasm execution, Rust structural-reader parity and
neutral typed-IR backend execution are not qualified by the Node tests or the
native .NET reference. Boolean Parse/TryParse/ToString/CompareTo and broader
Object/ValueType acceptance remain outside this field prerequisite. #783 stays open.
