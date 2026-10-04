# Boolean readonly string fields: qualified product and remaining contracts

Task: **SF-A07-T21 / #783**. The product adds genuine `System.Boolean.TrueString` and `FalseString` fields and the compiler/runtime mechanisms needed to preserve their identity and lifetime. **This is a draft prerequisite; #783 remains open.**

## Exact revisions

| Role | Commit or tree |
| --- | --- |
| Published product | `d6c6eb24eae3a7116b4bb5497c68b40b90aa3d2c` |
| Measured product | `af29812a6b0ca0184a79cc6bcddd01bf0a02fb6a` |
| Identical product tree | `d934a12e448fc825ad49a535ced67a801e98e57c` |
| Qualified comparison baseline | `af5450dacbdc2734432b13dffa63efb10eb93145` |

The GitHub-published commit preserves the exact measured tree. A second targeted replay at the published commit also passed **316/316 tests**, with zero failures, cancellations, skips or todos. Its [receipt](boolean-published-replay.json) contains the complete portable argv and all 18 input hashes; the [full TAP](boolean-published-replay-tests.tap) has SHA256 `e353db73377e51ac074235d6e3f4ba8d67cc02ea6db68ecf2a35b4b80b060d52`.

The [measured-tree qualification](boolean-optimized-qualification.json) records a successful clean npm install, 316 targeted tests, static checks (4,129 syntax modules and 4,113 imports), warning-mode structure check, and fresh build. Structure retained 268 existing warnings; no strict-clean result is claimed. Root package-lock bytes were unchanged. Main advanced independently after the comparison baseline; these results do not claim current-main integration qualification.

## Product behavior

- Fields retain genuine compiler symbols, source provenance and independent/canonical CIL `ldsfld` metadata. No method or opcode IDs are allocated.
- Admission validates approved owner, field, primitive string signature, signing identity, static access and address policy. Source raw markers cannot initialize static defaults.
- Lazy values use existing precise roots and snapshotted stores, while ordinary weak literals stay weak. Canonical rechecks preserve field/literal identity in both observer nesting directions.
- Bounded initialization, sticky same-key reentry, snapshot boundaries and explicit-stop guards prevent partial publication or pushes into retired stacks. Natural Main completion and between-call restore remain supported.
- Corrective scalar-cache and warm literal lookups remove identified avoidable work while retaining the cold initialization protections.

## Independent native reference

The frozen fixture used SDK **10.0.201**, CoreCLR **10.0.5**, Ubuntu 24.04.3 x64. Its capture records both real fields, metadata/assembly identity, UTF-16 values, literal and intern identity, distinct copies, collection and four cultures. Native observation does not qualify SharpForge host callbacks, which have separate Node tests.

| Artifact | SHA256 |
| --- | --- |
| Program.cs | `8cc63fdef39f630d63cb50718c68de43b759004c059ceb2dc08503d0dfb14dc0` |
| Project | `772eff4e2c0f9b0327bb80d130bf73799ec1f47fb8ff8a7572162535705973d4` |
| Captured JSON | `5155917b117ab8906d00c4863efa0220cd9b0140bd847037418585701dd13d69` |

## Performance decision

Ten existing controls ran in separate fresh processes in serial A1/B1/B2/A2 order, followed by two candidate-only Boolean field cases: **42 processes**, 5,000 iterations, five excluded warmups and nine retained samples per process. Existing comparisons pool 18 samples per revision. Machine: Node v24.19.0, Linux x64, AMD EPYC 9V74 80-Core Processor, shared host with the repository run-slot limiter. No dedicated-host claim is made.

Runner SHA256: `ba0202edda201ad0755f16e4e30811c90e8b9b5027b940b08819b63ae207c14e`. Setup, compilation/admission, explicit host GC and result checks are excluded; automatic managed collection is measured. Loop measurements include interpreter overhead and first initialization. The compiled scalar control measures `CONST`/`ldc.i8`; the separate CIL scalar-field control executes genuine `ldsfld`.

| Engine / existing control | Median baseline → candidate (ms/5,000) | Median change | Observed p95 baseline → candidate (ms) | p95 change |
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

**Four median exceptions and the adverse CIL tails are explicitly accepted** in the [independent performance review](boolean-optimized-performance-review.md). Cold source/CIL literals cost an additional 3.427368/5.572462 ms per 5,000 operations; source/CIL literal loops cost an additional 1.149242/10.089768 ms. The review explains the demonstrated correctness requirements, each individual decision, and unresolved attribution. Improvements elsewhere do not offset these exceptions. This is independent Codex agent sign-off, not human approval.

All existing controls have matching source/image/assembly hashes and unchanged managed allocations, bytes and collection counts in every retained sample. Host JavaScript allocation was not measured. Nearest-rank p95 over 18 samples is the largest retained observation; it is not a precise population tail estimate. No adverse sample was discarded or labeled noise. The initial bcd188 cohort remains **rejected and retained as history**, and its values are not mixed with this cohort.

New Boolean field operations have no baseline equivalent: source median/p95 **23.890973/31.434995 ms**, CIL **121.243846/178.332950 ms**, each per 5,000 iterations and with **2 managed allocations / 70 bytes / 0 collections**. The [full summary](boolean-optimized-controls-summary.json) retains all samples.

## Actual artifact sizes

| Package | Packed baseline → candidate bytes | Growth | Unpacked growth |
| --- | ---: | ---: | ---: |
| @sharpforge/bcl-core | 67,931 → 68,398 | +467 / 0.687462% | +1,379 / 0.549803% |
| @sharpforge/bytecode | 23,795 → 24,274 | +479 / 2.013028% | +1,631 / 1.983075% |
| @sharpforge/cil | 232,083 → 232,882 | +799 / 0.344273% | +2,838 / 0.343556% |
| @sharpforge/compiler | 1,064,667 → 1,064,983 | +316 / 0.029681% | +1,346 / 0.033237% |
| @sharpforge/framework | 22,295 → 22,695 | +400 / 1.794124% | +994 / 1.400651% |
| @sharpforge/runtime | 177,316 → 179,162 | +1,846 / 1.041079% | +6,336 / 1.010523% |

Fresh browser output: **112,935,639 bytes / 5,547 files → 112,989,490 bytes / 5,554 files**, an increase of **53,851 bytes / 0.0476829108%**. The 33 changed assets (7 new, none removed) sum to that exact delta.

The [independent artifact review](boolean-final-artifact-review.md) accepts all six compressed/unpacked packages and the browser output within budget. It checks 12 actual tarballs, all 2,264 payloads against committed Git blobs and paths, and all 11,101 emitted baseline/candidate files. Thirty changed emitted source leaves match exact source bytes or the documented browser import rewrite. Final runtime-worker hashes and optimized helper markers are retained. Package manifests and dependency declarations are unchanged. No >10% size exception is needed.

## Concrete remaining prerequisites

1. Reconcile task ownership/readiness for #783: its authoritative `agent/SF-A07-T21` ref was absent at the fresh read and the issue is marked blocked. An absent ref does not establish a lease or grant permission.
2. The A00 owners must review/apply/qualify the prepared structural-schema, typed-body, compatibility-gate and protected public-facade proposals. The current structural image schema rejects the new source carrier, and the typed adapter cannot lower it. These are material pending portable-source contracts.
3. Integrate with the then-current main and rerun the affected checks; promote only after the required contracts and claim are valid.
4. Boolean methods and the wider Object/ValueType scope in #783 remain separate outstanding work.

The [blocked-prerequisites bundle](../blocked-prerequisites/README.md) contains the exact unapplied patches, immutable claim evidence, path/lock mapping, root lockfile repair, red-black readiness proposal and seven owner-message drafts. No owner messages or Project field changes are performed by saving that bundle.

Limitations: `mscorlib4` field emission is explicitly rejected; source `String(char[])` remains unsupported, while the actual independent CIL constructor cancellation path is tested. Browser execution, SharpForge Rust/native/Wasm execution, Rust structural-reader parity and neutral typed-IR backend execution are not inferred from Node or native .NET reference capture.

## Complete retained evidence and replay

The [manifest](manifest.json) indexes every payload in [qualification.tar.gz](qualification.tar.gz), including all raw initial and optimized reports, execution records, full test/static/build/install logs, source patches and runners, package tarballs with per-file provenance, complete browser manifests, native sources/capture/build output, and independent reviews. The archive contains historical failed/rejected observations as well as final evidence; use the manifest revision notes and receipts to distinguish them.

| Archive field | Value |
| --- | --- |
| Compressed bytes | 4,649,911 |
| Entries including manifest | 272 |
| Archive SHA256 | `6a96a18ec0f827af61caee0cac5afb2feda7ba30ae09eeb9da949b880ec41914` |
| Manifest SHA256 | `40413c87fa6755665a4974924701ff3434fa16d5cf70dbe4cb8facc7f4c91c51` |

For the final test replay, check out the published product commit and execute the complete `argv` from `boolean-published-replay.json` at the repository root. These argv paths are repository-relative. The benchmark drivers retain original worktree paths and environment; change only their root-path mapping for another machine, preserve the recorded baseline/candidate and exact runner bytes, and keep the same serialized order. The initial/final product patches reconstruct their measured trees from the public baseline when the original local commit objects are unavailable.

PR CI status is recorded separately after PR creation; it cannot be inferred from local test or build success. The ordinary core workflow does not run this full targeted Node suite.
