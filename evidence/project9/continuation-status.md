# SharpForge Project #9 continuation status

**This continuation merged eight PRs, updated eight IO draft PRs, and opened the qualified Boolean field draft #4578. Project #9 is not complete.** The latest issue search still reports **300 open and 11 closed issues**, including parent and container issues; these counts do not mean that every open item is wholly unimplemented or technically blocked. The actual Ready queue displayed zero items at the retained 17:45:41 UTC UI check.

## Merged work

| PR | Delivered work | Local qualification highlights |
| --- | --- | --- |
| [#4518](https://github.com/wieslawsoltes/SharpForge/pull/4518) | Char boxing identity at object boundaries | 22 focused tests |
| [#4520](https://github.com/wieslawsoltes/SharpForge/pull/4520) | Repeated StringBuilder.Insert | 196 focused tests; 434 native reference rows |
| [#4535](https://github.com/wieslawsoltes/SharpForge/pull/4535) | Genuine external readonly scalar fields | 167 focused tests |
| [#4548](https://github.com/wieslawsoltes/SharpForge/pull/4548) | Managed Object.ToString callbacks | 357 focused tests |
| [#4555](https://github.com/wieslawsoltes/SharpForge/pull/4555) | Non-span StringBuilder edits and Object construction | 157 final focused tests; 546 native reference rows |
| [#4562](https://github.com/wieslawsoltes/SharpForge/pull/4562) | HashSet capacity and safe allocation-observer publication | 230 focused tests; native capacity/type/metadata references |
| [#4567](https://github.com/wieslawsoltes/SharpForge/pull/4567) | Stopwatch durations and synchronous clocks | 275 broad tests and 98 final focused tests; native duration and TimeSpan boundaries |
| [#4574](https://github.com/wieslawsoltes/SharpForge/pull/4574) | Stopwatch registry and generated inventory integration | 13/13 registry and inventory tests; prior two failures corrected |

Each merge followed its own successful required core check and a successful merged-main core check. Local focused suites were run separately because ordinary core does not run the unit suite. The cohorts overlap; their counts are not an aggregate count of unique tests. [Fresh merge records](merged-prs.json) retain exact heads, merge commits and times.

PR #4555 completed the non-span StringBuilder edit scope and [closed #2638](https://github.com/wieslawsoltes/SharpForge/issues/2638). The broader Object/ValueType/Boolean, HashSet and Stopwatch issue acceptance remains open where its remaining work is documented.

## Continued IO draft stack

Every published branch preserves its previous remote history. All eight draft PR bodies now describe the implementation, exact qualified tree, immutable evidence, performance/size decisions and the remaining clean-install step.

| PR | Current scope | Published head |
| --- | --- | --- |
| [#4509](https://github.com/wieslawsoltes/SharpForge/pull/4509) | StringReader | `0e7c56d8e9175ffad7c03dd7fd61ac0f1783b4a4` |
| [#4510](https://github.com/wieslawsoltes/SharpForge/pull/4510) | StringWriter | `2e6a7c5ba0eceaee24df8452ff54f098215eeef0` |
| [#4513](https://github.com/wieslawsoltes/SharpForge/pull/4513) | StringReader buffer reads | `d46b27fd25a681cc675c63cff3d32bf5c26c867a` |
| [#4514](https://github.com/wieslawsoltes/SharpForge/pull/4514) | StringWriter.ToString through object references | `d1499d108d127c9e1fcc6d37c0b4a0dd998feca7` |
| [#4515](https://github.com/wieslawsoltes/SharpForge/pull/4515) | StringWriter buffer writes | `41a42061e3f647a4ea1f7c38937d55d7c62fc63d` |
| [#4516](https://github.com/wieslawsoltes/SharpForge/pull/4516) | StringWriter buffer line writes | `b7e6fdfba9d4847fbc9c3c2ae20e893525663e5d` |
| [#4517](https://github.com/wieslawsoltes/SharpForge/pull/4517) | StringWriter character line writes | `3493f1b49e849b05274fc910d4e1a7f993e22a38` |
| [#4542](https://github.com/wieslawsoltes/SharpForge/pull/4542) | Boolean, integer, floating-point and Decimal scalar writes/lines | `16909aa003c61d63bcbe654cefda19e71f09d942` |

The final integrated product passed **278/278 tests** across 18 files, plus static checks, a fresh build, actual package checks and pinned .NET reference comparisons. The work includes the post-callback WriteLine state check and genuine Char JSON regression fixtures. PR #4514 accurately describes ToString through object references; it does not claim the separate Write(object) overload.

All eight published heads have a **failed core check at npm ci**. A real local clean-install attempt reproduced the missing BCL IO workspace/dependency entries while preserving the root lock hash. A four-entry root package-lock patch is prepared, but the authoritative package-json lock is still held by codex-p19-core under #2072. The fix must enter the oldest IO branch and then be integrated through the stack; these drafts have not been promoted or merged.

[Immutable complete IO qualification](https://github.com/wieslawsoltes/SharpForge/tree/c890bec08d53bf08295a36d67874a49f26672c8b/evidence/project9/io-qualified) retains native captures, raw measurements, full test receipts, actual package tarballs and browser manifests. [Published status and owner handoff](blocked-prerequisites/io/README.md) explain the exact remaining steps.

## New qualified Boolean field draft

[PR #4578](https://github.com/wieslawsoltes/SharpForge/pull/4578) is published at `d6c6eb24eae3a7116b4bb5497c68b40b90aa3d2c`, tree `d934a12e448fc825ad49a535ced67a801e98e57c`. It implements genuine public static readonly TrueString and FalseString fields, preserving compiler field symbols and real CIL metadata. It adds lazy per-VM identity, precise roots and snapshot lifetime, bounded reentry, canonical field/literal rechecks and cancellation-safe publication. Existing ordinary weak literals retain their weak lifetime.

The measured tree passed clean npm ci, **316/316 targeted tests**, static checks and a fresh build. The exact published commit then passed the same **316/316** replay with zero failures, cancellations, skips or todos. The native reference is pinned to .NET 10.0.5 / SDK 10.0.201. [Core run 37222761967](https://github.com/wieslawsoltes/SharpForge/actions/runs/37222761967) succeeded, and GitHub reported a clean merge with main at `7f4af78df79e3eac36302c50e0a589e0ce9e83ac`. Its unit-test step was skipped; the separate published-head replay is the targeted test evidence. No targeted replay of the current-main merge ref is claimed.

**The PR remains a draft.** Its new source carrier is still rejected by the current A00 structural image schema, and the source typed-body adapter cannot yet lower it. The reviewed schema, typed-body, compatibility-gate and public bytecode-facade proposals are prepared but unapplied in the reserved owner paths. The current SF-A07-T21 claim ref is absent, #783 has the state:blocked issue label, and Project Agent/Lease fields were unobserved. An absent ref does not establish an owned Ready task.

Boolean Parse/TryParse/ToString/CompareTo, wider Object/ValueType acceptance, current-main targeted integration, Rust/native/Wasm execution and structural/typed backend qualification are not completed by this field prerequisite. #783 remains open. [Full Boolean evidence](boolean-qualified/README.md), [final PR status](boolean-pr-status.json) and [saved PR description](boolean-pr-body.md) keep those limits explicit.

## Measured costs and qualification limits

The Boolean benchmark used 42 isolated processes with serialized ABBA controls and separate new-field measurements. Four medians exceeded the 5% budget: source cold literals +42.840%, source literal loops +5.961%, CIL cold literals +46.244% and CIL literal loops +9.165%. The absolute increases were 3.427368, 1.149242, 5.572462 and 10.089768 ms per 5,000 operations respectively. The adverse CIL tails are retained and explicitly reviewed. All existing managed allocation, byte and collection counters match.

The [independent performance review](boolean-qualified/boolean-optimized-performance-review.md) accepts each exception for the demonstrated correctness protections and bounded measured costs, while retaining uncertainty about whole-workload attribution. The initial rejected cohort is retained and never mixed with final results. Review is by independent Codex agents, not human approval.

All six affected Boolean package artifacts grew by less than 2.1%; the actual browser build grew by **53,851 bytes / 0.0476829108%**. The [artifact review](boolean-qualified/boolean-final-artifact-review.md) checked all 12 baseline/candidate tarballs, their 2,264 payloads, and 11,101 browser files. No greater-than-10% Boolean artifact exception was needed. Other completed work has its own disclosed costs: the IO package grew by 21.411% with 15 median exceptions after correction, the HashSet collection package grew by 44.320%, and the Stopwatch core package by 11.743%. Those acceptance records and full before/after rows remain in their respective PRs and retained evidence; small whole-browser percentages do not replace package-specific decisions.

Passing Node source/CIL tests, an ordinary core build and a pinned .NET reference capture are distinct results. They do not establish browser, Rust/native or Wasm execution parity. Structure checks remain warning-mode results with pre-existing warnings where reported.

## Remaining ownership and readiness work

The final authoritative refresh at **2026-10-04 18:05:27 UTC** found all seven saved shared-file owner refs unchanged. [Exact claim records](final-ownership-observation.json) include commits, generations, expiry times and immutable source URLs. The root package lock remains live through 2026-10-04 20:04:09.592 UTC; expiry by itself would still not authorize takeover.

For new collection work, #2664 (SF-A08-T04.1, the internal shared red-black tree core) remains **Backlog** and unimplemented. The existing code supplies the required internal heap/comparator mechanisms, but the formal readiness snapshot is stale and omits this leaf. Two narrow inherited-dependency scope rows are prepared for the planning owner. They do not remove the parent/sibling/direct/other transitive or mandatory contract requirements, and do not create a Ready item by themselves.

The checked-in planning/AGENTS.md and claim protocol prohibit implicit takeover and require an actual Ready leaf plus current, qualified prerequisite evidence before creating a new claim. The retained public UI has zero Ready items. This is the current process blocker for further new claims; it is not a finding that every open project item lacks usable code.

[The remaining project inventory](remaining-project-items.md) records the full issue scope. [The frozen prerequisite bundle](blocked-prerequisites/README.md) retains exact unapplied changes and provenance. [Seven complete coordination messages](coordination-messages/README.md) are ready for authorization and have not been posted:

| Issue | Requested owner action |
| --- | --- |
| #2072 | Integrate or explicitly hand off the four-entry IO root lock repair |
| #1062 | Extend scope and qualify the closed readonly-field structural schema |
| #1066 | Extend scope and qualify lowering through existing load-static |
| #1101 | Qualify the conservative additive compatibility proof |
| #1043 | Reconcile preserved ownership and acquire the public-facade lock |
| #1093 | Produce a truthful fresh canonical readiness snapshot |
| #1094 | Review the two inherited-dependency scope rows for #2664 |

After those owner changes are reviewed, applied and qualified, the next sequence is to repair and validate the IO stack, integrate the Boolean contracts and reconcile its claim, and then claim and implement the complete red-black tree core when its actual Ready state and canonical evidence permit it. The rest of the project remains open for continued implementation.
