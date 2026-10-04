# Project 4 remaining work and evidence — 2026-10-04

**Status: remaining work is not complete.** This record preserves 244 mapped identities and the distinction between implemented tooling,
unfinished code, qualification, reserved ownership, external configuration and upstream product requirements. It makes no new issue-closure,
Project-field, release or platform-pass claim.

## Scope and provenance

- Repository: [SharpForge](https://github.com/wieslawsoltes/SharpForge); requested board: [Project #4](https://github.com/users/wieslawsoltes/projects/4).
- Initial record prepared: `2026-10-04T12:28:25Z`; isolated record base: [dc84bcbfea54](https://github.com/wieslawsoltes/SharpForge/commit/dc84bcbfea548a152e239d60b3950f06b9ebd2c7).
- Live issue/claim observation: `2026-10-04T11:12:01Z` at source [ca3c083b61d6](https://github.com/wieslawsoltes/SharpForge/commit/ca3c083b61d637f98d53d0e55d9c2e564b11bf5d).
- Classification code inspection: `2026-10-04T11:45:46.044Z` with local inspection commit `db6eb3278c49043132554463ceffc18f8e50899d`.
- Session evidence summarized below: [session-results.json](session-results.json), updated at `2026-10-04T14:41:53.193882Z`. Its run-specific sources and owner-observation times remain separate from the earlier classification.
- The inputs agree on all 244 unique issue/Work-ID pairs and observed states: **109 A00, 133 A29, 2 R015; 204 open and 40 closed**.
- The open issues comprise **32 parent trackers and 172 non-parent items**; these are not 204 independent missing features.
- There are **43 group definitions, 40 populated groups**. `a00-services`, `a00-claims` and `a29-ci` preserve context with zero assigned rows.

**The initial audit did not retrieve actual Project membership and field projection.** It uses identities in
[`planning/project4-delivery.json`](https://github.com/wieslawsoltes/SharpForge/blob/ca3c083b61d637f98d53d0e55d9c2e564b11bf5d/planning/project4-delivery.json) and re-read repository issues.
At `2026-10-04T11:12:01Z`, Project GraphQL membership/field access was not exposed. Those 244 identities defined the initial mapped scope;
the later public-board capture independently reconciles them below. The release-overlay parent [#422](https://github.com/wieslawsoltes/SharpForge/issues/422), A10 item [#424](https://github.com/wieslawsoltes/SharpForge/issues/424)
and A26 item [#425](https://github.com/wieslawsoltes/SharpForge/issues/425) remain outside that mapped scope.

At **`2026-10-04T14:05:35.504Z`**, a complete read-only capture of the public active
[Board view](https://github.com/users/wieslawsoltes/projects/4/views/2) independently matched **all 244 exact issue/Work-ID pairs**:
244 mapped pairs, 244 board pairs, no mapped pair missing and no extra board pair. The
[DOM-backed observation](captures/project4-board-dom.json) is recorded canonically at `/projectBoardObservation` in
[session-results.json](session-results.json). It identifies **“SharpForge · Program, Contracts & Conformance”** and the visible views and columns.

| Observed public-board status | Items |
| --- | ---: |
| Backlog | 88 |
| Ready | 61 |
| Claimed | 11 |
| In progress | 40 |
| In review | 4 |
| Blocked | 0 |
| Done | 40 |

This completes the public active-board identity/status reconciliation at that observation time. It does **not** export the full GraphQL
field projection or verify Agent/lease ownership fields. Board status labels do not transfer reservations, release leases, prove readiness,
or establish issue closure. In particular, the board’s zero `Blocked` rows do not remove the technical and ownership blockers documented below.
The original issue/claim audit retains its earlier timestamp, states and all 68 historical claim records.

| Retained source | Contents and limits |
| --- | --- |
| [classification.json](classification.json) | Complete parsed classification input: all 43 definitions, all 244 issue records, acceptance text, deliverables, summarized leases and original session follow-ups. Only formatting is compacted. |
| [source-observations.json](source-observations.json) | Original input hashes, byte counts, timestamps, scope/summary and all 68 full claim records, with explicit references to later session and owner evidence. Full original audit and acceptance-inventory files are hash-identified rather than duplicated. |
| [session-results.json](session-results.json) | Authoritative session results: tested local and published source mappings, merged PRs, the TAP draft, public-board reconciliation, workflow reservation audit, regression reproductions, integrated runs, original findings, corrected replays and remaining qualification. |
| [capture-index.json](capture-index.json) | Complete index of 175 captures: the original 169 with unchanged digests, plus six raw records from the first failed evidence-publication core run. Byte counts, SHA-256 digests and explicit archival format labels are retained. |
| [verification-summary.json](verification-summary.json) | Data-integrity check results for indexed bytes, original-capture preservation, campaign-report digests, JSON reference pointers, local Markdown links, delivery identities and the complete 244-pair board reconciliation. The summary distinguishes integrity checks from product tests/builds and hosted qualification. |

The archived classification column below preserves the supplied classification, including descriptions of earlier in-progress branches.
The completion-obligation column and session sections explain later implementation evidence and remaining acceptance boundaries.
The original [classification.json](classification.json) remains unchanged; its earlier status descriptions must be read with the timestamped session results.

## How to read the remaining work

- **Code:** an adapter/profile or product behavior still needed implementation or integration at the classification observation.
- **Qualification:** a tool exists, but exact-source results, actual engines/platforms, required budgets and retained artifacts remain necessary.
- **Ownership/configuration:** a reserved path, Project capability, hosted credential/approval or external artifact operation prevents ordinary code work from completing acceptance.
- **Platform/product:** physical/OS behavior or upstream runtime/compiler/IDE capabilities must exist and execute before their dependent acceptance can pass.
- **Policy-deferred:** automatic/nightly criteria remain unfulfilled under the prevailing serial-validation policy; manual tools remain usable.
- **Parent/closed:** preserve observed closure and aggregate children without inventing independent capabilities or reopening old work.

## Full classification: 43 groups

Counts partition the 244 mapped identities exactly once. The issue mapping following this table supplies every issue URL and Work-ID.

| Group | Count | Archived classification | Concrete completion obligation or boundary |
| --- | ---: | --- | --- |
| `closed` | 40 | `closed-existing` | Preserve the 40 observed closures. They do not reopen automatically or become fresh platform evidence; three closed issues still have reserved claims. |
| `parent` | 32 | `parent-rollup` | These 32 aggregate trackers close only after child acceptance and retained evidence support the rollup. Avoid counting parents and children as separate delivered capabilities. |
| `a00-contracts` | 22 | `implemented-qualification` | Qualify the existing codec, ABI, schema and safepoint contracts at exact source revisions. The independent native structural schema reader exists; actual Rust/Wasm runtime execution remains an A27 prerequisite. |
| `a00-services` | 0 | `implemented-qualification` | Context only: child issues are in closed and aggregate issues in parent. Qualify the existing registration, rollback and disposal behavior across actual consumers, browsers/platforms and performance runs. |
| `a00-build` | 8 | `implemented-qualification` | Qualify manifest completeness, task/build registration, package discovery and the CI matrix at the final source revision and on the required platforms. |
| `a00-claims` | 0 | `implemented-regression-fixed-this-session` | Context only: closed child issues and open parents are counted elsewhere. Reconcile any session regression evidence in the final sections, and preserve all existing leases until explicit owner resolution. |
| `a00-governance` | 29 | `implemented-qualification-or-project-configuration` | The public active-board identities/statuses now match all 244 mapped pairs. Existing ownership, readiness, gate, handoff and rollup tools still need full GraphQL/Agent/lease field verification, authorized writes where configuration changes are required, linked-PR evidence and exact-source qualification. TAP qualification also has the reserved fixture dependency below. |
| `a00-seams` | 7 | `implemented-qualification` | Qualify the existing parser, diagnostic, declaration, dispatch and style seams with byte-identical corpora and comparable performance. Existing CIL extraction uses execution/cil-step.js and execution/handlers; duplicating the issue’s proposed path is unnecessary. |
| `a00-bootstrap` | 1 | `implemented-project-configuration` | Apply and verify the existing idempotent bootstrap against actual Project fields, views and labels when configured Project access is available. Public active-board identity/status reconciliation is complete; full field/configuration verification and authorized writes remain separate requirements. |
| `a29-ci` | 0 | `implemented-qualification` | Context only: child closures and parent rows hold the mapped identities. Retain independent hosted platform captures; ordinary core checks provide only the scope defined by serial validation policy. |
| `a29-oracles` | 7 | `implemented-external-qualification` | Run pinned SDK/Roslyn/CoreCLR/BCL oracles and actual Windows App SDK fixtures, including culture checks, repeated captures and output stability. Harness availability does not supply those results. |
| `a29-inventory` | 8 | `implemented-external-qualification` | Capture complete native reference inventories, actual probes and external-artifact provenance. Derive supported-surface percentages from verified inventory/probe evidence. |
| `a29-diff` | 6 | `implemented-qualification-and-upstream` | Run the complete differential corpus against pinned native CLR and retain reductions/classifications. Preserve unsupported A27 results until the required runtime artifacts exist. |
| `a29-schedule` | 2 | `policy-deferred-scheduling` | Nightly differential/performance criteria remain deferred by the prevailing staged serial policy. Record the policy decision explicitly; manual execution does not fulfill an automatic-trigger criterion. |
| `fuzz-harness` | 1 | `implemented-this-session-validation-pending` | Reconcile the session worker/campaign/corpus implementation with its final merged revision; retain bounded campaign, attribution, finding persistence and replay evidence. This does not establish native memory safety. |
| `fuzz-pe` | 1 | `implemented-profile-qualification-pending` | Post-fix duration qualification passed for the bounded PE loader/inspection profile on Node/Linux x64 at `d64188af91f0`: two 512-case campaigns completed 714,755 ms of campaign windows, with 4 accepted / 1,020 controlled rejections and no unsupported cases or findings. Original failed-run time receives zero credit. This establishes the recorded bounded scope; it does not qualify every parser input, another engine/platform or an OS sandbox. |
| `fuzz-bytecode` | 1 | `partial-code-feasible-with-bounded-profile-design` | PR #4556 implements constrained managed local calls, integer statics, fixed objects and integer arrays, with 4 frames, a 4,096-byte stack, 1,024 instructions and an 8,192-byte heap limit. General exception-handler admission, host calls and general metadata remain excluded; preserve those unsupported boundaries and qualify the required remaining scope. |
| `fuzz-pdb` | 1 | `partial-code-in-progress` | Reconcile the pinned, licensed Documents.pdb corpus and authored malformed/boundary cases into the final adapter revision; retain digest/provenance and actual bounded loader results. |
| `fuzz-zip` | 1 | `partial-code-in-progress` | Reconcile actual importWorkspaceZip/in-memory directory containment and finite decompression/declared-output cases with the final adapter. Retain results without host extraction or uncontrolled amplification. |
| `fuzz-protocol` | 1 | `partial-code-in-progress` | Reconcile real in-memory LSP/DAP request sequences, bounded launch and cleanup. Malformed native exceptions must remain findings; the DAP product fix is reserved to A14. |
| `fuzz-il` | 1 | `partial-cross-area-product-defect` | PR #4554 preserves full images for validated unchanged IL bodies, handles signed-zero/NaN representations, and compares exact image bytes. Its 32-case stronger-oracle campaign passed. Preserve the earlier `8019f2f9b22e` campaign as visible-text-only evidence; assess broader image and format coverage against the issue’s acceptance. |
| `fuzz-network` | 1 | `implemented-this-session-validation-pending` | Reconcile actual owned-loopback native-host authorization, path/sentinel checks, denied native spawn, bounded HTTP and teardown evidence. Fixed local reads do not qualify arbitrary providers or SDK execution. |
| `fuzz-corpus` | 1 | `implemented-this-session-plus-policy-deferred` | Retain reproducible finding metadata and normal-manifest replay for every saved input; an empty corpus is an explicit skip. Qualify the manual workflow separately; nightly execution remains policy-deferred. |
| `a29-browser` | 8 | `implemented-qualification-and-upstream` | Capture real three-engine/multi-OS browser runs and required physical IME, keyboard, DPI and GPU behavior. Isolated compute acceptance depends on actual A10 product behavior. |
| `a29-performance` | 6 | `implemented-qualification` | Retain comparable final-source samples, twenty A/A trials, Windows/Linux captures and a reviewed historical baseline. Existing normalization, budgets and gates do not replace measurements. |
| `a29-supply` | 8 | `implemented-qualification-and-external-configuration` | Configure and capture hosted OIDC signing, positive asset verification, private reporting/push protection and relevant runners. Existing dependency/SBOM/license/workflow gates establish only their measured scope. |
| `a29-repro` | 6 | `implemented-execution-evidence-pending` | Produce two independent exact-source builds and compare hashes with controlled tags, assets and caches. Retain provenance for source manifests, examples and links. |
| `a29-native` | 5 | `implemented-external-platform-qualification` | Measure all six OS/architecture cells with the required SDK8/10 and Node22/current combinations, including privileges, symlinks and Windows ACL behavior. |
| `a29-release-policy` | 5 | `implemented-qualification-and-external-configuration` | Complete hosted approval, true asset signatures, correct tag workflow and real preview-artifact evidence using the existing release tooling. Do not infer a released asset from a workflow definition. |
| `a29-preview` | 1 | `partial-upstream-compiler` | Implement and positively qualify unions, closed hierarchies and extension indexers through A01/A02 owners. Stable-mode rejection and skipped positive tests do not fulfill preview semantics. |
| `a29-acceptance` | 4 | `implemented-qualification-and-upstream` | Capture final-source Studio/CLI multi-project edit/build/debug/designer scenarios. Retain actual failures and route product defects to their owning areas. |
| `a29-git-publish` | 1 | `upstream-product-blocked` | Provide A25 product Git init/commit/branch/merge/auth and A26 app publishing before qualifying the scenario. Host git operations and IDE packaging cannot substitute for these product APIs. |
| `a29-e03` | 8 | `implemented-reserved-and-project-configuration` | Coordinate with existing owners for planning/queue/matrix/flaky/forms/Rust/stats paths. Real Project credentials, hosted dispatch, runtime/cost evidence and applicable Rust artifacts remain separate obligations. |
| `a29-suites` | 4 | `implemented-reserved-qualification-plus-adapter-boundaries` | Complete real native suite batches and platform captures through current suite owners. Extend unsupported dynamic builders, custom references, theories/helpers/assertions/templates only as explicitly scoped adapter work. |
| `a29-gc` | 2 | `implemented-reserved-upstream-and-qualification` | Retain complete JS stress captures and obtain actual runtime finalization/collector behavior from its owners. Native/Wasm parity requires A27 artifacts and independent execution. |
| `a29-gallery` | 2 | `implemented-reserved-native-qualification` | Capture real Windows oracle layout/automation and pinned ILVerify agreement per rule. Preserve WinUI/CIL product conformance failures for their owners. |
| `a29-recordings` | 1 | `implemented-reserved-external-client-qualification` | Populate the recording registry with authentic VS Code sessions and replay them through the actual stdio adapter. Synthetic traffic does not establish external-client recordings. |
| `a29-security` | 7 | `implemented-reserved-qualification` | Qualify current runtime/browser/deployed CSP, limits, sandbox and XSS/threat-model behavior, plus actual private-reporting configuration, while respecting current reservations. |
| `a29-rust` | 1 | `upstream-product-blocked` | Provide the A27 collector/runtime crates before sanitizer, Miri, loom and cargo-fuzz qualification. Rust-lane/unsafe-inventory plumbing or a structural reader is insufficient runtime evidence. |
| `a29-coverage` | 1 | `implemented-reserved-qualification` | Run the complete applicable manifest coverage serially and retain the uploaded artifact with floors and the exact source revision, coordinated with its owner. |
| `a29-archive` | 1 | `implemented-reserved-external-artifact-migration` | Complete owner-coordinated historical artifact upload, immutable-link verification and repository relocation. Preparation or selection alone does not establish migration completion. |
| `r015-audit` | 1 | `implemented-reserved-provenance-and-qualification` | Complete the source, mapping, claim and provenance audit for #423. Its acceptance permits explicitly recording that the historical snapshot is absent. That permitted absence does not satisfy the separate trusted-source/archive qualification in #426. |
| `r015-acceptance` | 1 | `implemented-reserved-upstream-and-external-qualification` | Wire and execute the implemented real-HTTP grant-revocation browser scenario through an authorized workflow/runner; implement host-wide fairness and managed WebSocket behavior. Also qualify remote Git/auth, independent document designers, duplicate-instance Hot Reload locks, app-only output, a trusted source/archive and physical/platform behavior. The #426 archive qualification remains unmet. |

## Complete mapped issue index

Issue states in the retained JSON are observations at `2026-10-04T11:12:01Z`, not current closure assertions. Each identity occurs in one group.

- **`closed` (40):** [SF-A00-T13 #431](https://github.com/wieslawsoltes/SharpForge/issues/431), [SF-A00-T24 #475](https://github.com/wieslawsoltes/SharpForge/issues/475), [SF-A00-T25 #476](https://github.com/wieslawsoltes/SharpForge/issues/476), [SF-A29-B01 #477](https://github.com/wieslawsoltes/SharpForge/issues/477), [SF-A29-B02 #478](https://github.com/wieslawsoltes/SharpForge/issues/478), [SF-A29-B04 #480](https://github.com/wieslawsoltes/SharpForge/issues/480), [SF-A29-B05 #481](https://github.com/wieslawsoltes/SharpForge/issues/481), [SF-A29-B06 #482](https://github.com/wieslawsoltes/SharpForge/issues/482), [SF-A00-T02.1 #1039](https://github.com/wieslawsoltes/SharpForge/issues/1039), [SF-A00-T02.2 #1040](https://github.com/wieslawsoltes/SharpForge/issues/1040), [SF-A00-T02.3 #1041](https://github.com/wieslawsoltes/SharpForge/issues/1041), [SF-A00-T02.4 #1042](https://github.com/wieslawsoltes/SharpForge/issues/1042), [SF-A00-T02.5 #1043](https://github.com/wieslawsoltes/SharpForge/issues/1043), [SF-A00-T02.6 #1044](https://github.com/wieslawsoltes/SharpForge/issues/1044), [SF-A00-T02.7 #1045](https://github.com/wieslawsoltes/SharpForge/issues/1045), [SF-A00-T02.8 #1046](https://github.com/wieslawsoltes/SharpForge/issues/1046), [SF-A00-T03.1 #1047](https://github.com/wieslawsoltes/SharpForge/issues/1047), [SF-A00-T03.2 #1048](https://github.com/wieslawsoltes/SharpForge/issues/1048), [SF-A00-T03.3 #1049](https://github.com/wieslawsoltes/SharpForge/issues/1049), [SF-A00-T03.4 #1050](https://github.com/wieslawsoltes/SharpForge/issues/1050), [SF-A00-T03.5 #1051](https://github.com/wieslawsoltes/SharpForge/issues/1051), [SF-A00-T03.6 #1052](https://github.com/wieslawsoltes/SharpForge/issues/1052), [SF-A00-T03.7 #1053](https://github.com/wieslawsoltes/SharpForge/issues/1053), [SF-A00-T03.8 #1054](https://github.com/wieslawsoltes/SharpForge/issues/1054), [SF-A00-T07.1 #1078](https://github.com/wieslawsoltes/SharpForge/issues/1078), [SF-A00-T07.2 #1079](https://github.com/wieslawsoltes/SharpForge/issues/1079), [SF-A00-T07.3 #1080](https://github.com/wieslawsoltes/SharpForge/issues/1080), [SF-A00-T07.4 #1081](https://github.com/wieslawsoltes/SharpForge/issues/1081), [SF-A00-T07.5 #1082](https://github.com/wieslawsoltes/SharpForge/issues/1082), [SF-A00-T07.6 #1083](https://github.com/wieslawsoltes/SharpForge/issues/1083), [SF-A00-T07.7 #1084](https://github.com/wieslawsoltes/SharpForge/issues/1084), [SF-A00-T07.8 #1085](https://github.com/wieslawsoltes/SharpForge/issues/1085), [SF-A29-T01.1 #1113](https://github.com/wieslawsoltes/SharpForge/issues/1113), [SF-A29-T01.2 #1114](https://github.com/wieslawsoltes/SharpForge/issues/1114), [SF-A29-T01.3 #1115](https://github.com/wieslawsoltes/SharpForge/issues/1115), [SF-A29-T01.4 #1116](https://github.com/wieslawsoltes/SharpForge/issues/1116), [SF-A29-T01.5 #1117](https://github.com/wieslawsoltes/SharpForge/issues/1117), [SF-A29-T01.6 #1118](https://github.com/wieslawsoltes/SharpForge/issues/1118), [SF-A29-T01.7 #1119](https://github.com/wieslawsoltes/SharpForge/issues/1119), [SF-A29-T01.8 #1120](https://github.com/wieslawsoltes/SharpForge/issues/1120)
- **`parent` (32):** [SF-A00-E01 #2](https://github.com/wieslawsoltes/SharpForge/issues/2), [SF-A00-E02 #3](https://github.com/wieslawsoltes/SharpForge/issues/3), [SF-A00-T01 #4](https://github.com/wieslawsoltes/SharpForge/issues/4), [SF-A00-T02 #5](https://github.com/wieslawsoltes/SharpForge/issues/5), [SF-A00-T03 #6](https://github.com/wieslawsoltes/SharpForge/issues/6), [SF-A00-T04 #7](https://github.com/wieslawsoltes/SharpForge/issues/7), [SF-A00-T05 #8](https://github.com/wieslawsoltes/SharpForge/issues/8), [SF-A00-T06 #9](https://github.com/wieslawsoltes/SharpForge/issues/9), [SF-A00-T07 #10](https://github.com/wieslawsoltes/SharpForge/issues/10), [SF-A00-T08 #11](https://github.com/wieslawsoltes/SharpForge/issues/11), [SF-A00-T09 #12](https://github.com/wieslawsoltes/SharpForge/issues/12), [SF-A00-T10 #13](https://github.com/wieslawsoltes/SharpForge/issues/13), [SF-A00-T11 #14](https://github.com/wieslawsoltes/SharpForge/issues/14), [SF-A00-T12 #15](https://github.com/wieslawsoltes/SharpForge/issues/15), [SF-A29-E01 #395](https://github.com/wieslawsoltes/SharpForge/issues/395), [SF-A29-E02 #396](https://github.com/wieslawsoltes/SharpForge/issues/396), [SF-A29-T01 #397](https://github.com/wieslawsoltes/SharpForge/issues/397), [SF-A29-T02 #398](https://github.com/wieslawsoltes/SharpForge/issues/398), [SF-A29-T03 #399](https://github.com/wieslawsoltes/SharpForge/issues/399), [SF-A29-T04 #400](https://github.com/wieslawsoltes/SharpForge/issues/400), [SF-A29-T05 #401](https://github.com/wieslawsoltes/SharpForge/issues/401), [SF-A29-T06 #402](https://github.com/wieslawsoltes/SharpForge/issues/402), [SF-A29-T07 #403](https://github.com/wieslawsoltes/SharpForge/issues/403), [SF-A29-T08 #404](https://github.com/wieslawsoltes/SharpForge/issues/404), [SF-A29-T09 #405](https://github.com/wieslawsoltes/SharpForge/issues/405), [SF-A29-T10 #406](https://github.com/wieslawsoltes/SharpForge/issues/406), [SF-A29-T11 #407](https://github.com/wieslawsoltes/SharpForge/issues/407), [SF-A29-T12 #408](https://github.com/wieslawsoltes/SharpForge/issues/408), [SF-A00-E03 #427](https://github.com/wieslawsoltes/SharpForge/issues/427), [SF-A29-E03 #428](https://github.com/wieslawsoltes/SharpForge/issues/428), [SF-A29-E04 #429](https://github.com/wieslawsoltes/SharpForge/issues/429), [SF-A29-E05 #430](https://github.com/wieslawsoltes/SharpForge/issues/430)
- **`a00-contracts` (22):** [SF-A00-T01.1 #1032](https://github.com/wieslawsoltes/SharpForge/issues/1032), [SF-A00-T01.2 #1033](https://github.com/wieslawsoltes/SharpForge/issues/1033), [SF-A00-T01.3 #1034](https://github.com/wieslawsoltes/SharpForge/issues/1034), [SF-A00-T01.4 #1035](https://github.com/wieslawsoltes/SharpForge/issues/1035), [SF-A00-T01.5 #1036](https://github.com/wieslawsoltes/SharpForge/issues/1036), [SF-A00-T01.6 #1037](https://github.com/wieslawsoltes/SharpForge/issues/1037), [SF-A00-T01.7 #1038](https://github.com/wieslawsoltes/SharpForge/issues/1038), [SF-A00-T04.1 #1055](https://github.com/wieslawsoltes/SharpForge/issues/1055), [SF-A00-T04.2 #1056](https://github.com/wieslawsoltes/SharpForge/issues/1056), [SF-A00-T04.3 #1057](https://github.com/wieslawsoltes/SharpForge/issues/1057), [SF-A00-T04.4 #1058](https://github.com/wieslawsoltes/SharpForge/issues/1058), [SF-A00-T04.5 #1059](https://github.com/wieslawsoltes/SharpForge/issues/1059), [SF-A00-T04.6 #1060](https://github.com/wieslawsoltes/SharpForge/issues/1060), [SF-A00-T04.7 #1061](https://github.com/wieslawsoltes/SharpForge/issues/1061), [SF-A00-T05.1 #1062](https://github.com/wieslawsoltes/SharpForge/issues/1062), [SF-A00-T05.2 #1063](https://github.com/wieslawsoltes/SharpForge/issues/1063), [SF-A00-T05.3 #1064](https://github.com/wieslawsoltes/SharpForge/issues/1064), [SF-A00-T05.4 #1065](https://github.com/wieslawsoltes/SharpForge/issues/1065), [SF-A00-T05.5 #1066](https://github.com/wieslawsoltes/SharpForge/issues/1066), [SF-A00-T05.6 #1067](https://github.com/wieslawsoltes/SharpForge/issues/1067), [SF-A00-T05.7 #1068](https://github.com/wieslawsoltes/SharpForge/issues/1068), [SF-A00-T05.8 #1069](https://github.com/wieslawsoltes/SharpForge/issues/1069)
- **`a00-services` (0):** Context only; no additional mapped issues.
- **`a00-build` (8):** [SF-A00-T06.1 #1070](https://github.com/wieslawsoltes/SharpForge/issues/1070), [SF-A00-T06.2 #1071](https://github.com/wieslawsoltes/SharpForge/issues/1071), [SF-A00-T06.3 #1072](https://github.com/wieslawsoltes/SharpForge/issues/1072), [SF-A00-T06.4 #1073](https://github.com/wieslawsoltes/SharpForge/issues/1073), [SF-A00-T06.5 #1074](https://github.com/wieslawsoltes/SharpForge/issues/1074), [SF-A00-T06.6 #1075](https://github.com/wieslawsoltes/SharpForge/issues/1075), [SF-A00-T06.7 #1076](https://github.com/wieslawsoltes/SharpForge/issues/1076), [SF-A00-T06.8 #1077](https://github.com/wieslawsoltes/SharpForge/issues/1077)
- **`a00-claims` (0):** Context only; no additional mapped issues.
- **`a00-governance` (29):** [SF-A00-T22 #440](https://github.com/wieslawsoltes/SharpForge/issues/440), [SF-A00-T23 #441](https://github.com/wieslawsoltes/SharpForge/issues/441), [SF-A00-T08.1 #1086](https://github.com/wieslawsoltes/SharpForge/issues/1086), [SF-A00-T08.2 #1087](https://github.com/wieslawsoltes/SharpForge/issues/1087), [SF-A00-T08.3 #1088](https://github.com/wieslawsoltes/SharpForge/issues/1088), [SF-A00-T08.4 #1089](https://github.com/wieslawsoltes/SharpForge/issues/1089), [SF-A00-T08.5 #1090](https://github.com/wieslawsoltes/SharpForge/issues/1090), [SF-A00-T08.6 #1091](https://github.com/wieslawsoltes/SharpForge/issues/1091), [SF-A00-T09.1 #1092](https://github.com/wieslawsoltes/SharpForge/issues/1092), [SF-A00-T09.2 #1093](https://github.com/wieslawsoltes/SharpForge/issues/1093), [SF-A00-T09.3 #1094](https://github.com/wieslawsoltes/SharpForge/issues/1094), [SF-A00-T09.4 #1095](https://github.com/wieslawsoltes/SharpForge/issues/1095), [SF-A00-T09.5 #1096](https://github.com/wieslawsoltes/SharpForge/issues/1096), [SF-A00-T09.6 #1097](https://github.com/wieslawsoltes/SharpForge/issues/1097), [SF-A00-T10.1 #1098](https://github.com/wieslawsoltes/SharpForge/issues/1098), [SF-A00-T10.2 #1099](https://github.com/wieslawsoltes/SharpForge/issues/1099), [SF-A00-T10.3 #1100](https://github.com/wieslawsoltes/SharpForge/issues/1100), [SF-A00-T10.4 #1101](https://github.com/wieslawsoltes/SharpForge/issues/1101), [SF-A00-T10.5 #1102](https://github.com/wieslawsoltes/SharpForge/issues/1102), [SF-A00-T11.1 #1103](https://github.com/wieslawsoltes/SharpForge/issues/1103), [SF-A00-T11.2 #1104](https://github.com/wieslawsoltes/SharpForge/issues/1104), [SF-A00-T11.3 #1105](https://github.com/wieslawsoltes/SharpForge/issues/1105), [SF-A00-T11.4 #1106](https://github.com/wieslawsoltes/SharpForge/issues/1106), [SF-A00-T11.5 #1107](https://github.com/wieslawsoltes/SharpForge/issues/1107), [SF-A00-T12.1 #1108](https://github.com/wieslawsoltes/SharpForge/issues/1108), [SF-A00-T12.2 #1109](https://github.com/wieslawsoltes/SharpForge/issues/1109), [SF-A00-T12.3 #1110](https://github.com/wieslawsoltes/SharpForge/issues/1110), [SF-A00-T12.4 #1111](https://github.com/wieslawsoltes/SharpForge/issues/1111), [SF-A00-T12.5 #1112](https://github.com/wieslawsoltes/SharpForge/issues/1112)
- **`a00-seams` (7):** [SF-A00-T14 #432](https://github.com/wieslawsoltes/SharpForge/issues/432), [SF-A00-T15 #433](https://github.com/wieslawsoltes/SharpForge/issues/433), [SF-A00-T16 #434](https://github.com/wieslawsoltes/SharpForge/issues/434), [SF-A00-T17 #435](https://github.com/wieslawsoltes/SharpForge/issues/435), [SF-A00-T18 #436](https://github.com/wieslawsoltes/SharpForge/issues/436), [SF-A00-T19 #437](https://github.com/wieslawsoltes/SharpForge/issues/437), [SF-A00-T20 #438](https://github.com/wieslawsoltes/SharpForge/issues/438)
- **`a00-bootstrap` (1):** [SF-A00-T21 #439](https://github.com/wieslawsoltes/SharpForge/issues/439)
- **`a29-ci` (0):** Context only; no additional mapped issues.
- **`a29-oracles` (7):** [SF-A29-T02.1 #1121](https://github.com/wieslawsoltes/SharpForge/issues/1121), [SF-A29-T02.2 #1122](https://github.com/wieslawsoltes/SharpForge/issues/1122), [SF-A29-T02.3 #1123](https://github.com/wieslawsoltes/SharpForge/issues/1123), [SF-A29-T02.4 #1124](https://github.com/wieslawsoltes/SharpForge/issues/1124), [SF-A29-T02.5 #1125](https://github.com/wieslawsoltes/SharpForge/issues/1125), [SF-A29-T02.6 #1126](https://github.com/wieslawsoltes/SharpForge/issues/1126), [SF-A29-T02.7 #1127](https://github.com/wieslawsoltes/SharpForge/issues/1127)
- **`a29-inventory` (8):** [SF-A29-T03.1 #1128](https://github.com/wieslawsoltes/SharpForge/issues/1128), [SF-A29-T03.2 #1129](https://github.com/wieslawsoltes/SharpForge/issues/1129), [SF-A29-T03.3 #1130](https://github.com/wieslawsoltes/SharpForge/issues/1130), [SF-A29-T03.4 #1131](https://github.com/wieslawsoltes/SharpForge/issues/1131), [SF-A29-T03.5 #1132](https://github.com/wieslawsoltes/SharpForge/issues/1132), [SF-A29-T03.6 #1133](https://github.com/wieslawsoltes/SharpForge/issues/1133), [SF-A29-T03.7 #1134](https://github.com/wieslawsoltes/SharpForge/issues/1134), [SF-A29-T03.8 #1135](https://github.com/wieslawsoltes/SharpForge/issues/1135)
- **`a29-diff` (6):** [SF-A29-T04.1 #1136](https://github.com/wieslawsoltes/SharpForge/issues/1136), [SF-A29-T04.2 #1137](https://github.com/wieslawsoltes/SharpForge/issues/1137), [SF-A29-T04.3 #1138](https://github.com/wieslawsoltes/SharpForge/issues/1138), [SF-A29-T04.4 #1139](https://github.com/wieslawsoltes/SharpForge/issues/1139), [SF-A29-T04.5 #1140](https://github.com/wieslawsoltes/SharpForge/issues/1140), [SF-A29-T04.6 #1141](https://github.com/wieslawsoltes/SharpForge/issues/1141)
- **`a29-schedule` (2):** [SF-A29-T04.7 #1142](https://github.com/wieslawsoltes/SharpForge/issues/1142), [SF-A29-T07.7 #1166](https://github.com/wieslawsoltes/SharpForge/issues/1166)
- **`fuzz-harness` (1):** [SF-A29-T05.1 #1143](https://github.com/wieslawsoltes/SharpForge/issues/1143)
- **`fuzz-pe` (1):** [SF-A29-T05.2 #1144](https://github.com/wieslawsoltes/SharpForge/issues/1144)
- **`fuzz-bytecode` (1):** [SF-A29-T05.3 #1145](https://github.com/wieslawsoltes/SharpForge/issues/1145)
- **`fuzz-pdb` (1):** [SF-A29-T05.4 #1146](https://github.com/wieslawsoltes/SharpForge/issues/1146)
- **`fuzz-zip` (1):** [SF-A29-T05.5 #1147](https://github.com/wieslawsoltes/SharpForge/issues/1147)
- **`fuzz-protocol` (1):** [SF-A29-T05.6 #1148](https://github.com/wieslawsoltes/SharpForge/issues/1148)
- **`fuzz-il` (1):** [SF-A29-T05.7 #1149](https://github.com/wieslawsoltes/SharpForge/issues/1149)
- **`fuzz-network` (1):** [SF-A29-T05.8 #1150](https://github.com/wieslawsoltes/SharpForge/issues/1150)
- **`fuzz-corpus` (1):** [SF-A29-T05.9 #1151](https://github.com/wieslawsoltes/SharpForge/issues/1151)
- **`a29-browser` (8):** [SF-A29-T06.1 #1152](https://github.com/wieslawsoltes/SharpForge/issues/1152), [SF-A29-T06.2 #1153](https://github.com/wieslawsoltes/SharpForge/issues/1153), [SF-A29-T06.3 #1154](https://github.com/wieslawsoltes/SharpForge/issues/1154), [SF-A29-T06.4 #1155](https://github.com/wieslawsoltes/SharpForge/issues/1155), [SF-A29-T06.5 #1156](https://github.com/wieslawsoltes/SharpForge/issues/1156), [SF-A29-T06.6 #1157](https://github.com/wieslawsoltes/SharpForge/issues/1157), [SF-A29-T06.7 #1158](https://github.com/wieslawsoltes/SharpForge/issues/1158), [SF-A29-T06.8 #1159](https://github.com/wieslawsoltes/SharpForge/issues/1159)
- **`a29-performance` (6):** [SF-A29-T07.1 #1160](https://github.com/wieslawsoltes/SharpForge/issues/1160), [SF-A29-T07.2 #1161](https://github.com/wieslawsoltes/SharpForge/issues/1161), [SF-A29-T07.3 #1162](https://github.com/wieslawsoltes/SharpForge/issues/1162), [SF-A29-T07.4 #1163](https://github.com/wieslawsoltes/SharpForge/issues/1163), [SF-A29-T07.5 #1164](https://github.com/wieslawsoltes/SharpForge/issues/1164), [SF-A29-T07.6 #1165](https://github.com/wieslawsoltes/SharpForge/issues/1165)
- **`a29-supply` (8):** [SF-A29-T08.1 #1167](https://github.com/wieslawsoltes/SharpForge/issues/1167), [SF-A29-T08.2 #1168](https://github.com/wieslawsoltes/SharpForge/issues/1168), [SF-A29-T08.3 #1169](https://github.com/wieslawsoltes/SharpForge/issues/1169), [SF-A29-T08.4 #1170](https://github.com/wieslawsoltes/SharpForge/issues/1170), [SF-A29-T08.5 #1171](https://github.com/wieslawsoltes/SharpForge/issues/1171), [SF-A29-T08.6 #1172](https://github.com/wieslawsoltes/SharpForge/issues/1172), [SF-A29-T08.7 #1173](https://github.com/wieslawsoltes/SharpForge/issues/1173), [SF-A29-T08.8 #1174](https://github.com/wieslawsoltes/SharpForge/issues/1174)
- **`a29-repro` (6):** [SF-A29-T09.1 #1175](https://github.com/wieslawsoltes/SharpForge/issues/1175), [SF-A29-T09.2 #1176](https://github.com/wieslawsoltes/SharpForge/issues/1176), [SF-A29-T09.3 #1177](https://github.com/wieslawsoltes/SharpForge/issues/1177), [SF-A29-T09.4 #1178](https://github.com/wieslawsoltes/SharpForge/issues/1178), [SF-A29-T09.5 #1179](https://github.com/wieslawsoltes/SharpForge/issues/1179), [SF-A29-T12.5 #1195](https://github.com/wieslawsoltes/SharpForge/issues/1195)
- **`a29-native` (5):** [SF-A29-T10.1 #1180](https://github.com/wieslawsoltes/SharpForge/issues/1180), [SF-A29-T10.2 #1181](https://github.com/wieslawsoltes/SharpForge/issues/1181), [SF-A29-T10.3 #1182](https://github.com/wieslawsoltes/SharpForge/issues/1182), [SF-A29-T10.4 #1183](https://github.com/wieslawsoltes/SharpForge/issues/1183), [SF-A29-T10.5 #1184](https://github.com/wieslawsoltes/SharpForge/issues/1184)
- **`a29-release-policy` (5):** [SF-A29-T11.1 #1185](https://github.com/wieslawsoltes/SharpForge/issues/1185), [SF-A29-T11.3 #1187](https://github.com/wieslawsoltes/SharpForge/issues/1187), [SF-A29-T11.4 #1188](https://github.com/wieslawsoltes/SharpForge/issues/1188), [SF-A29-T11.5 #1189](https://github.com/wieslawsoltes/SharpForge/issues/1189), [SF-A29-T11.6 #1190](https://github.com/wieslawsoltes/SharpForge/issues/1190)
- **`a29-preview` (1):** [SF-A29-T11.2 #1186](https://github.com/wieslawsoltes/SharpForge/issues/1186)
- **`a29-acceptance` (4):** [SF-A29-T12.1 #1191](https://github.com/wieslawsoltes/SharpForge/issues/1191), [SF-A29-T12.2 #1192](https://github.com/wieslawsoltes/SharpForge/issues/1192), [SF-A29-T12.3 #1193](https://github.com/wieslawsoltes/SharpForge/issues/1193), [SF-A29-T12.6 #1196](https://github.com/wieslawsoltes/SharpForge/issues/1196)
- **`a29-git-publish` (1):** [SF-A29-T12.4 #1194](https://github.com/wieslawsoltes/SharpForge/issues/1194)
- **`a29-e03` (8):** [SF-A29-T13 #483](https://github.com/wieslawsoltes/SharpForge/issues/483), [SF-A29-T14 #484](https://github.com/wieslawsoltes/SharpForge/issues/484), [SF-A29-T15 #485](https://github.com/wieslawsoltes/SharpForge/issues/485), [SF-A29-T16 #486](https://github.com/wieslawsoltes/SharpForge/issues/486), [SF-A29-T17 #487](https://github.com/wieslawsoltes/SharpForge/issues/487), [SF-A29-T18 #488](https://github.com/wieslawsoltes/SharpForge/issues/488), [SF-A29-T19 #489](https://github.com/wieslawsoltes/SharpForge/issues/489), [SF-A29-T20 #490](https://github.com/wieslawsoltes/SharpForge/issues/490)
- **`a29-suites` (4):** [SF-A29-T21 #491](https://github.com/wieslawsoltes/SharpForge/issues/491), [SF-A29-T22 #492](https://github.com/wieslawsoltes/SharpForge/issues/492), [SF-A29-T23 #493](https://github.com/wieslawsoltes/SharpForge/issues/493), [SF-A29-T24 #494](https://github.com/wieslawsoltes/SharpForge/issues/494)
- **`a29-gc` (2):** [SF-A29-T25 #495](https://github.com/wieslawsoltes/SharpForge/issues/495), [SF-A29-T38 #508](https://github.com/wieslawsoltes/SharpForge/issues/508)
- **`a29-gallery` (2):** [SF-A29-T26 #496](https://github.com/wieslawsoltes/SharpForge/issues/496), [SF-A29-T27 #497](https://github.com/wieslawsoltes/SharpForge/issues/497)
- **`a29-recordings` (1):** [SF-A29-T28 #498](https://github.com/wieslawsoltes/SharpForge/issues/498)
- **`a29-security` (7):** [SF-A29-B03 #479](https://github.com/wieslawsoltes/SharpForge/issues/479), [SF-A29-T29 #499](https://github.com/wieslawsoltes/SharpForge/issues/499), [SF-A29-T30 #500](https://github.com/wieslawsoltes/SharpForge/issues/500), [SF-A29-T31 #501](https://github.com/wieslawsoltes/SharpForge/issues/501), [SF-A29-T32 #502](https://github.com/wieslawsoltes/SharpForge/issues/502), [SF-A29-T33 #503](https://github.com/wieslawsoltes/SharpForge/issues/503), [SF-A29-T34 #504](https://github.com/wieslawsoltes/SharpForge/issues/504)
- **`a29-rust` (1):** [SF-A29-T35 #505](https://github.com/wieslawsoltes/SharpForge/issues/505)
- **`a29-coverage` (1):** [SF-A29-T36 #506](https://github.com/wieslawsoltes/SharpForge/issues/506)
- **`a29-archive` (1):** [SF-A29-T37 #507](https://github.com/wieslawsoltes/SharpForge/issues/507)
- **`r015-audit` (1):** [SF-R015-T01 #423](https://github.com/wieslawsoltes/SharpForge/issues/423)
- **`r015-acceptance` (1):** [SF-R015-T04 #426](https://github.com/wieslawsoltes/SharpForge/issues/426)

## Ownership and immediate integration blockers

At the audit observation, **68 authoritative claims across 23 owners were reserved, with none expired at that observation**.
An old observation, later expiry, closed issue or merged implementation does not transfer ownership. This record neither asserts a claim nor reconciles a reservation.

**The classification’s lease summaries omit nonempty `activePaths` for 11 tasks.** Their identities, owners, generations and locks agree
with the live audit, but an empty summary path list is not evidence that a path is free. The full claims are retained in
[source-observations.json](source-observations.json); re-read authoritative refs before editing. The affected summaries are:

`SF-A00-T15`, `SF-A29-T13`, `SF-A29-T14`, `SF-A29-T15`, `SF-A29-T17`, `SF-A29-T18`, `SF-A29-T19`, `SF-A29-T20`, `SF-A29-T02.5`, `SF-A29-T02.6`, `SF-A29-T02.7`.

The closed items still holding recorded claims are `SF-A00-T13`, `SF-A29-B06`, `SF-A00-T02.5`.

### TAP evidence: SF-A00-T11.3 / SF-A29-T17

[PR #4547](https://github.com/wieslawsoltes/SharpForge/pull/4547) remains **draft**. Its structural TAP and named-suite proof tests
record [50 passed, 0 failed](captures/tap-fixed.tap), and [PR core succeeded](https://github.com/wieslawsoltes/SharpForge/actions/runs/37203146801).
The existing flaky-consumer suite records [4 passed, 2 failed](captures/tap-flaky-consumer.tap). Those consumer failures keep integration pending.

The mock in `tests/conformance/flaky/detect.test.js` emits counters and a plan without a numbered `ok`/`not ok` result.
The minimal owner correction supplies a status-matching numbered result before the plan, followed by serial regression validation.
Structural evidence validation must continue to refuse counter-only reports.

The authoritative fixture reservation was re-read at **`2026-10-04T13:15:13.467Z`**:
[SF-A29-T17 #487](https://github.com/wieslawsoltes/SharpForge/issues/487), owner **`codex-p4-registries`**, lock **`a29-ci-487`**,
with `tests/conformance/flaky/**` and `scripts/conformance/flaky/**` among its reserved paths.
The [claim ref](https://api.github.com/repos/wieslawsoltes/SharpForge/contents/claim.json?ref=agent%2FSF-A29-T17) is a mutable source;
the actual observed payload, generation and expiry are retained at `/ownerRefreshes/tap` in [session-results.json](session-results.json).
Its `observedAt` is the re-read time, distinct from the claim’s creation and heartbeat times. No ownership transfer is inferred.

### DAP product prerequisite: A14 ownership

Malformed DAP envelope/null-argument native exceptions remain product findings for the A14 owner of `packages/protocol/src/dap.js`.
The A29 protocol adapter must preserve those findings rather than relabel native exceptions as intentional protocol errors.
The finite seed that passed the protocol profile below does not establish that all malformed DAP operations are handled.

The authoritative owner claim was re-read at **`2026-10-04T13:15:13.470Z`**:
[SF-A14-T06.6 #2860](https://github.com/wieslawsoltes/SharpForge/issues/2860), owner **`codex-a14-dap-error-body`**,
branch `codex/a14-dap-error-body`, for the DAP error-body prerequisite related to `SF-A29-T28`.
The [claim ref](https://api.github.com/repos/wieslawsoltes/SharpForge/contents/claim.json?ref=agent%2FSF-A14-T06.6) and its observed
write/coordinated paths are recorded at `/ownerRefreshes/dap` in [session-results.json](session-results.json).
This owner observation supplies a concrete reservation; it does not establish that the repair or its qualification has finished.

### Nightly criteria remain deferred

The [serial validation policy](https://github.com/wieslawsoltes/SharpForge/blob/dc84bcbfea548a152e239d60b3950f06b9ebd2c7/planning/qualification/serial-validation.md) defers specialty automatic triggers.
This affects [SF-A29-T04.7 #1142](https://github.com/wieslawsoltes/SharpForge/issues/1142), [SF-A29-T07.7 #1166](https://github.com/wieslawsoltes/SharpForge/issues/1166),
and the nightly criterion of [SF-A29-T05.9 #1151](https://github.com/wieslawsoltes/SharpForge/issues/1151). Manual workflows and normal retained-corpus replay
are separate capabilities. Re-enabling schedules or silently marking the nightly criterion satisfied is not part of this record.

## Merged implementation evidence

At the session-record update shown above, **18 implementation PRs through #4556 are merged**, and their recorded PR and main core runs succeeded.
The table links each measured batch; focused suites overlap and their counts must not be added to claim unique test coverage.
The separately recorded corrected integration below has its own total. The TAP draft is excluded from this merged count.

The [delivery record index](captures/deliveries/record-index.json), generated at `2026-10-04T14:13:36.348884Z`, lists **54 retained raw records for all 18 deliveries**:
PR snapshots and successful PR/main workflow-run records. It is a derived index. The original [48-record observation](captures/deliveries/observation.json)
retains its `2026-10-04T13:24:33.992Z` capture timestamp; the six later IL/bytecode snapshots were captured after their respective successful runs.
Index generation does not re-date those observations. Published heads, merge commits and run identities matched the session delivery record.

Local runs used Node `v24.19.0` on Linux x64. Ordinary core declares Node 22 and performs static/manifest, policy and build checks;
it skips Node unit tests under the serial validation policy. Dedicated build/fuzz lanes have their own pins.
Core success therefore needs the separately retained focused and integrated test logs when assessing tested behavior.

### Local and published source identity

GitHub API publication produced different commit metadata from local commits. The session record reports byte-for-byte comparison
of every published implementation tree with its tested local tree. The table shows **local tested commit → published implementation head**,
followed by the published merge commit. Full hashes and tree identities are retained in [session-results.json](session-results.json).
Local hashes are plain text; only recorded published heads and merges receive GitHub commit links.

The earlier local inspection commit `db6eb3278c49043132554463ceffc18f8e50899d` retains its original input identity and has no asserted published URL.
The initial campaign and browser attempt also retain their original local identities, with equivalent published sources recorded separately.
An equivalent source tree allows retrieval of the tested code; it does not rewrite a capture’s original commit or outcome.

| PR and implemented scope | Tested local → published head | Published merge | Focused result and capture | Successful core runs |
| --- | --- | --- | --- | --- |
| [#4521](https://github.com/wieslawsoltes/SharpForge/pull/4521) — A00 immutable claim generation | `d2504f7d1ca2` → [960266c71ab6](https://github.com/wieslawsoltes/SharpForge/commit/960266c71ab6f7322be6a36e4e3c4d1a582b129c) | [ae63ececd3d5](https://github.com/wieslawsoltes/SharpForge/commit/ae63ececd3d55856843c9c65119a4770483ba664) | [28 passed / 0 failed](captures/a00-fixed.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37198468903) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37198688358) |
| [#4522](https://github.com/wieslawsoltes/SharpForge/pull/4522) — A00 authoritative audit ordering | `f51c5203464d` → [51cd00ffc585](https://github.com/wieslawsoltes/SharpForge/commit/51cd00ffc5850cf511c0899355f0bc43d4472e02) | [69d398b2a0f5](https://github.com/wieslawsoltes/SharpForge/commit/69d398b2a0f5b6cff83a3a79655f574a41d527a0) | [32 passed / 0 failed](captures/audit-fixed.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37198601260) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37198779228) |
| [#4524](https://github.com/wieslawsoltes/SharpForge/pull/4524) — Four binary fuzz adapters | `a73dbc518cf4` → [ff74074766ce](https://github.com/wieslawsoltes/SharpForge/commit/ff74074766cefab5c78135d586c01f08f3849f01) | [0185c712c24c](https://github.com/wieslawsoltes/SharpForge/commit/0185c712c24c1f793b341a2240a6053d9093d597) | [26 passed / 0 failed](captures/fuzz-binary.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37198727169) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37199040727) |
| [#4525](https://github.com/wieslawsoltes/SharpForge/pull/4525) — Text and network policy fuzz adapters | `1676816080c6` → [ae19984c056b](https://github.com/wieslawsoltes/SharpForge/commit/ae19984c056b62417cb1c050bbe18eb3d6e0874b) | [ac715d285877](https://github.com/wieslawsoltes/SharpForge/commit/ac715d2858774465d751813f06185b17f3d0bb87) | [25 passed / 0 failed](captures/fuzz-text.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37198890109) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37199374939) |
| [#4527](https://github.com/wieslawsoltes/SharpForge/pull/4527) — Isolated bounded fuzz harness and corpus | `99ec786c7ca5` → [b6a8e503721f](https://github.com/wieslawsoltes/SharpForge/commit/b6a8e503721f1d08489924e9b24f2094f5e8a3f3) | [5a74e83d4a57](https://github.com/wieslawsoltes/SharpForge/commit/5a74e83d4a576f50c07d1983b3377e20a881924d) | [68 passed / 0 failed](captures/runtime-focused.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37199850911) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37199915703) |
| [#4528](https://github.com/wieslawsoltes/SharpForge/pull/4528) — Fuzz CLI, reports, reproduction and manual workflow | `7d7a7c000cd1` → [739881471ea5](https://github.com/wieslawsoltes/SharpForge/commit/739881471ea5a5b88c263321982cbe7b5c11b44d) | [003654ce10a4](https://github.com/wieslawsoltes/SharpForge/commit/003654ce10a49889f8def8f269dff059223e5eee) | [6 passed / 0 failed / 1 skipped](captures/cli-focused.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37200084469) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37200162965) |
| [#4529](https://github.com/wieslawsoltes/SharpForge/pull/4529) — R015 production session I/O fixture | `c519eb7f961a` → [1b41f3b4a6b7](https://github.com/wieslawsoltes/SharpForge/commit/1b41f3b4a6b75eb0dbb9a530ccbfe9cc2867de7c) | [47d80eedb06b](https://github.com/wieslawsoltes/SharpForge/commit/47d80eedb06b505013b162e73d5e2ad24082b54e) | [8 passed / 0 failed](captures/session-io-final.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37200463380) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37200554123) |
| [#4531](https://github.com/wieslawsoltes/SharpForge/pull/4531) — Portable PDB fixtures and actual workspace ZIP import | `fa5c0fef9093` → [ad0ea92f16bd](https://github.com/wieslawsoltes/SharpForge/commit/ad0ea92f16bddcbcfecce884b93579fe94617c04) | [0bab6df9c7d9](https://github.com/wieslawsoltes/SharpForge/commit/0bab6df9c7d9e764604c400aec78fd6ba6db91f8) | [42 passed / 0 failed](captures/binary-expanded.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37200790970) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37200914492) |
| [#4534](https://github.com/wieslawsoltes/SharpForge/pull/4534) — Worker deadline precedence | `5bfd3a953abe` → [3e91fd6c4810](https://github.com/wieslawsoltes/SharpForge/commit/3e91fd6c481038583f8fbddea9795d377fd803db) | [7b7ed128017b](https://github.com/wieslawsoltes/SharpForge/commit/7b7ed128017b4b966dfa389ab6eedef46e863985) | [21 passed / 0 failed](captures/worker-focused.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37201749884) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37201832323) |
| [#4536](https://github.com/wieslawsoltes/SharpForge/pull/4536) — LSP envelope validation | `624291c6156b` → [6908f30ce7a2](https://github.com/wieslawsoltes/SharpForge/commit/6908f30ce7a26b64721357a60220f9f24e2e7e58) | [a15f7c3dddc3](https://github.com/wieslawsoltes/SharpForge/commit/a15f7c3dddc34434968489d8ce8eb19f2af90022) | [30 passed / 0 failed](captures/lsp-fixed.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37202031016) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37202097511) |
| [#4538](https://github.com/wieslawsoltes/SharpForge/pull/4538) — Symbol compression contract and original corpus replay | `fab8efc873b3` → [1bcc97cedfdb](https://github.com/wieslawsoltes/SharpForge/commit/1bcc97cedfdb64a4e5a25f83612fb87872464a90) | [6c5b634cf5a1](https://github.com/wieslawsoltes/SharpForge/commit/6c5b634cf5a1ad7b829a05bc7a9b1ebc224af1de) | [12 passed / 0 failed](captures/symbols-final.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37202374930) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37202447000) |
| [#4539](https://github.com/wieslawsoltes/SharpForge/pull/4539) — Actual LSP/DAP request sequences | `6ee824fa5af0` → [543c91d7abb3](https://github.com/wieslawsoltes/SharpForge/commit/543c91d7abb359dfb61950a70fd825896400a0e6) | [e1f1571b34a2](https://github.com/wieslawsoltes/SharpForge/commit/e1f1571b34a2abc83f1e49eeda65d8115c6a35ef) | [40 passed / 0 failed](captures/protocol-final.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37202546956) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37202658132) |
| [#4543](https://github.com/wieslawsoltes/SharpForge/pull/4543) — Actual native-host authorization and containment | `5f6d0664ba2f` → [4c01a5b46c3d](https://github.com/wieslawsoltes/SharpForge/commit/4c01a5b46c3daf7c2c05c587f30632b267d3513e) | [17db935b862a](https://github.com/wieslawsoltes/SharpForge/commit/17db935b862a6a26fe39e41f2287ba3e620dc628) | [34 passed / 0 failed](captures/native-final.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37202759135) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37202858593) |
| [#4546](https://github.com/wieslawsoltes/SharpForge/pull/4546) — Actual HTTP streams, byte limits and cancellation | `050caf59d685` → [4bf18f59be85](https://github.com/wieslawsoltes/SharpForge/commit/4bf18f59be85b59001b64ef18296f1fe8a670301) | [bf85020e6024](https://github.com/wieslawsoltes/SharpForge/commit/bf85020e6024cdd679a0234d9f050ca7dedddf53) | [47 passed / 0 failed](captures/http-final.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37202959583) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37203030692) |
| [#4549](https://github.com/wieslawsoltes/SharpForge/pull/4549) — LSP parameter and method validation | `9b6887173938` → [0179c25b37ea](https://github.com/wieslawsoltes/SharpForge/commit/0179c25b37ea1701e1c99e32799975aecfea9f5b) | [8df7304f3895](https://github.com/wieslawsoltes/SharpForge/commit/8df7304f3895d721c8fe95923fb3d349646d0d6c) | [60 passed / 0 failed](captures/lsp-params-fixed.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37204492122) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37204541306) |
| [#4550](https://github.com/wieslawsoltes/SharpForge/pull/4550) — Controlled malformed metadata UTF-8 rejection and two retained PE inputs | `f0362e5e1874` → [c9357cc985ed](https://github.com/wieslawsoltes/SharpForge/commit/c9357cc985ed1dbe2bd2b76f99ef5e3cb81d89a9) | [8019f2f9b22e](https://github.com/wieslawsoltes/SharpForge/commit/8019f2f9b22e26d7c221454f3b751b0b0e0c67df) | [34 passed / 0 failed](captures/pe-utf8-final.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37204857889) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37204915609) |
| [#4554](https://github.com/wieslawsoltes/SharpForge/pull/4554) — Full image preservation for validated unchanged IL bodies, signed-zero/NaN handling, and exact image fuzz comparison. | `9e6235635fdf` → [7ae8ae6727f6](https://github.com/wieslawsoltes/SharpForge/commit/7ae8ae6727f627be4cd63c56099814f5004f9c29) | [b519b371d10b](https://github.com/wieslawsoltes/SharpForge/commit/b519b371d10b35299004aa142b73696bd482d4cc) | [124 passed / 0 failed](captures/il-idempotence-fixed.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37206598569) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37206929616) |
| [#4556](https://github.com/wieslawsoltes/SharpForge/pull/4556) — Constrained managed local calls, integer statics, fixed objects and integer arrays; general metadata, host calls and exception-handler admission remain excluded. | `cde74a88fcb8` → [6dcf13fae492](https://github.com/wieslawsoltes/SharpForge/commit/6dcf13fae492f7ba74197d88770e3c26251126d4) | [d64188af91f0](https://github.com/wieslawsoltes/SharpForge/commit/d64188af91f03d02041316bdde2ee64fd0634be0) | [39 passed / 0 failed](captures/bytecode-profile-fixed.tap) | [PR](https://github.com/wieslawsoltes/SharpForge/actions/runs/37207262331) / [main](https://github.com/wieslawsoltes/SharpForge/actions/runs/37207356433) |

## Recorded validation and campaign evidence

[session-results.json](session-results.json) is authoritative for result details and later updates. The historical audit and classification
remain evidence of their own observation times. The captures below record executed scopes, including failures and unsupported results;
none of these observations asserts issue closure, full Project membership, release qualification or complete product acceptance.

### Capture format and regression proof

Capture bytes retain their original reporter and wrapper output. The `.tap` extension is a historical filename, not proof of TAP structure:
`a00-parent.tap`, `binary-expanded.tap`, `cli-focused.tap`, `fuzz-integrated-final.tap`, `runtime-focused.tap` and `session-io-final.tap`
contain Node spec-reporter output. `audit-fixed.tap` and `symbols-final.tap` include a limiter preamble before the TAP header.
Use their counts in the context of the original run. These ordinary test logs are not asserted to qualify as strict TAP artifacts or a
`parity-v2` evidence bundle merely because they are linked here. The [capture index](capture-index.json) identifies retained bytes;
format acceptance remains a separate check against the applicable evidence contract.

The [original bytecode parent-probe source](captures/bytecode-profile-parent-probe.mjs.txt) is archived as text with original filename
`bytecode-profile-parent-probe.mjs` recorded in metadata. Its **1,341 bytes** and SHA-256
`6fb5f58bb67dc28d0c50592cd154e882a42590a129dd6d18bff3da03d61f5168` are unchanged. Historical run logs preserve the original filename.

| Parent regression scope | Recorded source boundary | Actual parent result | Retained capture |
| --- | --- | --- | --- |
| Immutable claim generation | `ca3c083b61d637f98d53d0e55d9c2e564b11bf5d` | 1 passed / 9 failed | [Original log](captures/a00-parent.tap) |
| Audit event history | Before the audit fix; original batch provenance is linked from [PR #4522](https://github.com/wieslawsoltes/SharpForge/pull/4522). No extra parent hash is invented here. | 3 passed / 11 failed | [Original log](captures/audit-parent.tap) |
| TAP, symbol and LSP regression files | `055b6484a5b1adbb31546660192819d45fd74b6b`, with only new regression files copied into the parent checkout | 9 passed / 49 failed: TAP 6/30, symbols 1/2, LSP 2/17 | [Combined parent log](captures/review-parent.tap) |
| LSP parameter containers and method names | `bf85020e6024cdd679a0234d9f050ca7dedddf53`, with the new public regression files copied into the parent checkout | 21 passed / 11 failed | [Parent log](captures/lsp-params-parent.tap) |
| Malformed metadata UTF-8 | `bf85020e6024cdd679a0234d9f050ca7dedddf53`, with the new public regression file copied into the parent checkout | 3 passed / 4 failed | [Parent log](captures/pe-utf8-parent.tap) |
| Exact IL image preservation and floating operand roundtrips | `8019f2f9b22e26d7c221454f3b751b0b0e0c67df`, with the two new public regression files copied into the parent checkout | 2 passed / 12 failed | [Parent log](captures/il-idempotence-parent.tap) |
| Bytecode profile admission probe | Clean source `8019f2f9b22e26d7c221454f3b751b0b0e0c67df`; nine verified probe images | 2 accepted / 7 unsupported. This is profile admission evidence, not nine passing execution tests. | [Parent probe](captures/bytecode-profile-parent.log) |

Reproduction checkouts containing copied regression files are intentionally not clean-parent qualification runs. The corresponding
fixed focused results are in the merged-PR table; TAP’s fixed and incompatible consumer results remain in its draft section.
The earlier [bytecode setup failure](captures/bytecode-profile-setup-failure.tap) ran no test bodies because workspace package links were absent.
After the links were created, the fixed bytecode suite recorded 39 passed and 0 failed; the setup failure is preserved separately.

At clean source `8019f2f9b22e26d7c221454f3b751b0b0e0c67df`, the existing A00 public capture/handoff/resume suite records
[14 passed, 0 failed](captures/a00-evidence-walkthrough.tap), using real temporary bare Git remotes and fake HTTP. The separate fake
claim/lock/heartbeat/release walkthrough exited 0; its [raw log](captures/a00-claim-release-walkthrough.log) and
[command-emitted audit object](captures/a00-claim-release-result.json) are retained. These local integration fixtures do not change live claims
and do not incorporate the separate structural TAP draft. Full commands and source details are at `/a00EndToEnd` in [session-results.json](session-results.json).

### Original campaigns, findings and corrected replays

| Observation | Exact-source relationship | Actual result and qualification boundary | Retained evidence |
| --- | --- | --- | --- |
| Earlier eight-target bounded campaign, 256 cases | Original local `07c833a82084b8fc07e4d9263bf83e315998e1ab`; equivalent published tree [7200c4020384](https://github.com/wieslawsoltes/SharpForge/commit/7200c40203843a84dc0438a6dcee4ccdc390130c) | 37 accepted, 213 rejected, 6 unsupported, 0 findings. Overall `unsupported`, `qualified: false`. This earlier profile does not qualify the expanded adapters. | [Original summary](captures/initial-campaign-seed1/summary.json) |
| Original Portable PDB finding | Clean published source [ad0ea92f16bd](https://github.com/wieslawsoltes/SharpForge/commit/ad0ea92f16bddcbcfecce884b93579fe94617c04) | Unexpected reserved-DEFLATE-block error. PR #4538 retains the original input and record and supplies controlled `SymbolError` rejection in ordinary corpus replay. | [Original observation](captures/pdb-original-capture/observation.json), [fixed tests](captures/symbols-final.tap) |
| Original PE campaign, 512 cases | Clean merged source [bf85020e6024](https://github.com/wieslawsoltes/SharpForge/commit/bf85020e6024cdd679a0234d9f050ca7dedddf53) | **Failed:** 2 accepted, 508 rejected, 2 unexpected UTF-8 findings at indices **88** and **463**, 0 unsupported. Elapsed **351,421 ms**, below the 600,000 ms duration requirement. Original failure remains unqualified and contributes no duration credit to a post-fix run. | [Duration result](captures/pe-original-duration.json), [original campaign](captures/pe-original-seed1/summary.json) |
| Corrected replay of both original PE finding records | Product fix local `33f754dcac94080842042020719ea6b8a4289e3f`; published [0a79a303af7f](https://github.com/wieslawsoltes/SharpForge/commit/0a79a303af7fefd66a795ee7aaca6a18e27f6068), before the final retained-corpus commit in PR #4550 | **2 passed, 0 findings.** The unchanged original records now receive controlled rejection. Replay is separate from duration qualification. | [Original-record replay](captures/pe-utf8-fixed-original-replay/summary.json) |
| Final retained production corpus | Final PR #4550 local `f0362e5e187409daf5766c70157280fe580afeae`; published [c9357cc985ed](https://github.com/wieslawsoltes/SharpForge/commit/c9357cc985ed1dbe2bd2b76f99ef5e3cb81d89a9) | **3 passed, 0 findings:** the Portable PDB record and both PE records. The original captures and failure identities remain preserved. | [Final corpus replay](captures/pe-utf8-final-corpus-replay/summary.json) |
| Earlier corrected expanded campaign, all eight adapters, 32 cases each | Clean source before and after: [8019f2f9b22e](https://github.com/wieslawsoltes/SharpForge/commit/8019f2f9b22e26d7c221454f3b751b0b0e0c67df); seed 1; `2026-10-04T13:17:38.108Z`–`2026-10-04T13:20:54.554Z` | 256 completed: **62 accepted, 192 rejected, 2 unsupported, 0 findings**. Seven adapter profiles passed; `bytecode-image` reported the two unsupported cases. Overall `unsupported`, `qualified: false`. IL covers visible-text stability at this historical source. PR #4554 subsequently adds the stronger full-image oracle below; known DAP malformed operations remain separate obligations. | [Corrected campaign summary](captures/corrected-campaign-seed1/summary.json) |
| Stronger IL exact-image campaign, 32 cases | Clean local source before and after `9e6235635fdfb92939e8d7cbf1985db774d1fa31`; equivalent published head [7ae8ae6727f6](https://github.com/wieslawsoltes/SharpForge/commit/7ae8ae6727f627be4cd63c56099814f5004f9c29) in PR #4554 | **Passed, qualified for this bounded campaign:** 7 accepted, 25 rejected, 0 unsupported, 0 findings. Full image bytes are compared after format/assemble, including unchanged-body preservation and floating-representation cases. | [Exact-image campaign](captures/il-exact-seed1/summary.json), [124/0 focused tests](captures/il-idempotence-fixed.tap) |
| Final 18-PR expanded campaign, all eight adapters, 32 cases each | Clean source before and after [d64188af91f0](https://github.com/wieslawsoltes/SharpForge/commit/d64188af91f03d02041316bdde2ee64fd0634be0), tree `d683a1cee6e29cddb2735734878f70c1ea382a05`; `2026-10-04T14:01:29.233Z`–`2026-10-04T14:04:31.478Z` | **256 completed: 71 accepted, 179 rejected, 6 unsupported, 0 findings, 0 cancelled.** Overall `unsupported`, `qualified: false`, process exit 2. Seven profiles passed; bytecode recorded 10 accepted, 16 rejected and 6 unsupported. The stronger IL profile recorded 7 accepted and 25 rejected. | [Final campaign summary](captures/final18-campaign-seed1/summary.json) |
| Post-fix PE duration qualification, two 512-case campaigns, seeds 1 and 2 | Clean source [d64188af91f0](https://github.com/wieslawsoltes/SharpForge/commit/d64188af91f03d02041316bdde2ee64fd0634be0), tree `d683a1cee6e29cddb2735734878f70c1ea382a05`; bounded Node/Linux x64 PE-loader scope | **Passed, `qualified: true`, exit 0:** 1,024 completed cases, **4 accepted / 1,020 rejected / 0 unsupported / 0 findings / 0 cancelled**. Completed campaign windows total **714,755 ms (11 min 54.755 s)**, exceeding 600,000 ms; gaps between campaigns are excluded. The original failed campaign’s 351,421 ms receives **zero credit**. | [Duration result](captures/pe-postfix-duration.json), [process log](captures/pe-postfix-duration.log), [seed 1](captures/pe-postfix-seed1/summary.json), [seed 2](captures/pe-postfix-seed2/summary.json), [supervisor](captures/pe-postfix-supervisor.py) |

### Implemented IL and bytecode scope

[PR #4554](https://github.com/wieslawsoltes/SharpForge/pull/4554) closes the reviewed image-idempotence implementation gap for validated
unchanged IL bodies. Its reconstruction path preserves the full image, and its fuzz oracle compares image bytes as well as the
signed-zero/NaN representation behavior covered by the focused suite. The earlier visible-text campaign remains historical evidence
of that earlier oracle. A passing 32-case campaign establishes the exercised source/profile, with broader acceptance still tied to its required corpus and coverage.

[PR #4556](https://github.com/wieslawsoltes/SharpForge/pull/4556) expands the verified execution profile to constrained managed local calls,
integer statics, fixed objects and integer arrays. The [profile](https://github.com/wieslawsoltes/SharpForge/blob/d64188af91f03d02041316bdde2ee64fd0634be0/scripts/conformance/fuzz/targets/binary-bytecode-profile.js)
admits execution under **4 frames, 4,096 stack bytes, 1,024 instructions and 8,192 heap bytes**. General exception-handler admission,
host calls and general metadata remain excluded. The parent’s seven unsupported probe images and the fixed suite’s 39/0 result make
that extension reviewable without implying support for all verified bytecode images. The final combined integration includes both changes.

### R015 source and browser acceptance boundaries

[SF-R015-T01 #423](https://github.com/wieslawsoltes/SharpForge/issues/423) permits the audit to explicitly record an absent historical snapshot.
That is an allowed audit result, while the source/archive qualification required by
[SF-R015-T04 #426](https://github.com/wieslawsoltes/SharpForge/issues/426) remains unmet. This mapped issue record does not supply the missing archive.

Real HTTP grant revocation is implemented, and the production session-I/O fixture was merged in [PR #4529](https://github.com/wieslawsoltes/SharpForge/pull/4529).
The browser capture’s build passed, but its overall status is `failed` at `browser-setup`: the pinned Playwright 1.63.0 Chromium driver
was unavailable and both full-browser and headless-shell download attempts failed. The component status is **`unexecuted`**, so the capture
supplies no browser scenario pass or product-behavior failure. Pins were retained. The [full report](captures/session-io-capture/report.json)
binds this attempt to local `c519eb7f961a6e4f912c33524168febb4c10fab2` and equivalent published source
[1b41f3b4a6b75](https://github.com/wieslawsoltes/SharpForge/commit/1b41f3b4a6b75eb0dbb9a530ccbfe9cc2867de7c).

The [canonical workflow/reservation audit](captures/r015-workflow-reservation.json), referenced at
`/sessionIo/hostedWorkflowAudit` in [session-results.json](session-results.json), found **no existing hosted entry invoking the actual production runner**.
The implemented [runner](https://github.com/wieslawsoltes/SharpForge/blob/d64188af91f03d02041316bdde2ee64fd0634be0/scripts/conformance/release15/session-io-run.js)
and [scenario contract](https://github.com/wieslawsoltes/SharpForge/blob/d64188af91f03d02041316bdde2ee64fd0634be0/planning/qualification/release15/session-io.md)
therefore still need authorized hosted integration and execution.

A concrete [separate manual-workflow proposal](captures/r015-workflow-proposal.yml) has been reviewed and retained. It is **not applied and has not been hosted-tested**.
The audit did not establish the live, owned, directly scoped leaf-task claim required to acquire `ci-workflows` for that proposal.
Existing [ci.yml](https://github.com/wieslawsoltes/SharpForge/blob/d64188af91f03d02041316bdde2ee64fd0634be0/.github/workflows/ci.yml)
and R015 runner scopes remain reserved. Legitimate task ownership and workflow-dispatch capability are prerequisites for this execution path.
A central full-ci run of existing jobs would not by itself execute this currently unwired scenario. The local missing-browser result supplies
no evidence that an appropriately configured hosted runner is unavailable.

Host-wide fairness and managed WebSocket support remain code gaps. Remote Git/auth, independent designers, duplicate-instance Hot Reload
locks, app-only output and actual platform/physical behavior also retain their specific acceptance obligations. An available hosted browser
or platform runner can still supply useful qualification; the local driver failure does not establish that all platform work is impossible.

## Evidence-publication core failure and archive correction

The first non-cancelled ordinary-core run for [PR #4564](https://github.com/wieslawsoltes/SharpForge/pull/4564)
[failed](https://github.com/wieslawsoltes/SharpForge/actions/runs/37209773138/job/111458416587) on `static-imports`.
Its published head was [24fe2d86e387](https://github.com/wieslawsoltes/SharpForge/commit/24fe2d86e3871997ac2266a9b3b0d21b0d44030c),
while the actual pull-request merge checkout was [b8c6b9d6c24c](https://github.com/wieslawsoltes/SharpForge/commit/b8c6b9d6c24c953da49c37c64fa2216fb27a8ae3).
The check found the original disposable parent probe’s three dynamic imports at lines 9–11 because its retained `.mjs` filename made it
look like a repository runtime module. The failure is separate from the earlier passing implementation tests and remains part of this record.

The six original records are preserved: [run](captures/evidence-pr4564-first-core/run.json),
[jobs](captures/evidence-pr4564-first-core/jobs.json), [actual checkout](captures/evidence-pr4564-first-core/checkout-commit.json),
[PR snapshot](captures/evidence-pr4564-first-core/pr.json), [events](captures/evidence-pr4564-first-core/events.json)
and [raw core log](captures/evidence-pr4564-first-core/core-job.log). Other jobs in this run report skipped outcomes and supply no additional platform result.

The correction renames only the archived probe to [bytecode-profile-parent-probe.mjs.txt](captures/bytecode-profile-parent-probe.mjs.txt)
and updates its references, format metadata and index entry. Original source bytes and all 169 earlier capture digests remain unchanged;
the original filename is retained in metadata and in the historical diagnostics. No policy exemption or probe-content edit is introduced.
Corrected local checks/build and a subsequent hosted core result are **pending**. Exact evidence and correction scope are recorded at
`/evidencePublication` in [session-results.json](session-results.json).

## Final qualification status

These three named rows summarize the current integrated scope. Update their exact-source results from [session-results.json](session-results.json)
when additional validation finishes; preserve the earlier observations above, including failed and unsupported campaigns.

| Qualification row | Actual recorded state | Evidence and remaining work |
| --- | --- | --- |
| **Corrected integrated validation** | **317 passed / 0 failed / 0 skipped / 0 cancelled**; `npm run check` and build passed at clean merged source `d64188af91f03d02041316bdde2ee64fd0634be0`, tree `d683a1cee6e29cddb2735734878f70c1ea382a05`. | [Final 18-PR integrated tests](captures/final-18/integrated.tap), [checks](captures/final-18/check.log), [build](captures/final-18/build.log) and [execution record](captures/final-18/run.json). The record retains exact argv, timing and before/after source identities. Checks cover **3,942 syntax modules / 3,938 linked modules**, with zero syntax/import errors or manifest unassigned/duplicate entries. Earlier [200/0](captures/integrated-final.tap) at `bf85020e6024` and [222/0](captures/integrated-corrected.tap) at `8019f2f9b22e` remain separate historical integrations. |
| **Fuzz campaigns** | Final eight-target campaign remains **overall unsupported**: 71 accepted / 179 rejected / 6 unsupported / 0 findings / 0 cancelled, `qualified: false`, exit 2. **Post-fix PE duration passed** separately: 1,024 cases across seeds 1 and 2, 4 accepted / 1,020 rejected / 0 unsupported / 0 findings / 0 cancelled, **714,755 ms**, exit 0. | Both results bind to clean `d64188af91f03d02041316bdde2ee64fd0634be0`. The [final expanded campaign](captures/final18-campaign-seed1/summary.json) retains six unsupported bytecode cases. The [PE duration result](captures/pe-postfix-duration.json) exceeds its 600,000 ms requirement using completed campaign windows only; gaps and all 351,421 ms of the old failed run receive no credit. PE qualification is limited to the bounded Node/Linux x64 loader profile and establishes no universal parser, other-engine/platform or OS-sandbox safety claim. Exact captures and limitations are at `/pendingQualification/finalExpandedTargets` and `/pendingQualification/postFixPeDuration` in [session-results.json](session-results.json). |
| **Central full-ci** | **Pending.** No central full-ci run or result is recorded at this observation. | The available mechanism is the `full-ci` PR label after the integrated scope is ready; manual workflow dispatch capability was absent. Retain the actual triggering PR/head, hosted run URL and per-job outcomes when available. Ordinary core results above do not establish this broader run. Specialty/nightly trigger criteria remain policy-deferred independently. |

## Remaining completion work

The remaining classification is concrete: resolve the TAP fixture and DAP owner integrations; qualify the required remaining IL corpus
and bytecode scope beyond the implemented bounded profiles; preserve the completed bounded PE duration evidence while completing remaining manifest and hosted/platform qualification;
complete native/oracle, trusted archive, signing, recording and external configuration evidence; and verify the remaining full GraphQL/Agent/lease field projection.
The public active-board identity/status reconciliation is complete at its recorded timestamp; its status labels do not replace authoritative ownership checks.
R015 additionally needs authorized real-runner CI wiring, actual browser/platform execution and its unmet product behavior. Upstream compiler/runtime/Git/publish and
physical-device requirements remain with their owners until the actual behavior and evidence exist. Preserve the 40 observed closures,
outstanding parent rollups and policy-deferred criteria. The implementation batches and measured runs above do not complete every remaining
Project 4 item.
