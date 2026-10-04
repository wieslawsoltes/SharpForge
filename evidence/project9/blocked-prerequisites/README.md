# Project #9 blocked-prerequisites handoff

This bundle makes the remaining coordination requests concrete. It contains exact copies of the unapplied Boolean A00 patches, the root package-lock patch, the six original red-black readiness files, fresh ownership/status observations and seven issue handoff drafts. **None of the proposed tracked changes has been applied by this bundle, and none of the drafts has been posted.**

Publication URL placeholder: [[BLOCKED_PREREQUISITES_BUNDLE_URL]]

## Current state and scope

| Evidence | Observation | Meaning and limit |
| --- | --- | --- |
| GitHub issue searches, 2026-10-04 17:29:48–17:30:08 UTC | Project #9 has **300 open, 11 closed, 311 total issues**; all searches report complete results | Issue-state counts, not a claim that every open item is technically blocked or implemented |
| Root's fresh public Project UI, 17:45:41 UTC | Ready view 3, filter `status:Ready -kind:Epic`, displays **0 items** | Actual visible Project state; not a generated readiness snapshot |
| Root's fresh public Project UI, 17:45:41 UTC | The single `SF-A08-T04.1` row, issue #2664, is open and **Backlog** | The internal red-black core remains unimplemented and unqualified; Project Agent/Lease were not visible |
| Authoritative ref refresh, 17:42:34 UTC | The seven saved package/A00 claim commits are unchanged | No owner release or generation change was observed |
| IO PR refresh, 17:30 UTC | #4509, #4510, #4513, #4514, #4515, #4516, #4517 and #4542 are all open drafts, unmerged | Their public heads are retained in `io/io-published-status-fresh.json` |
| Exact IO head checks, 17:33:52 UTC | Eight `core` failures, 64 other skipped checks; 72 returned checks complete | Fresh conclusions; the failed npm-ci step is separately established by retained original job/step evidence |
| Boolean task ref and issue | `agent/SF-A07-T21` is absent; #783 is open with no assignees or comments | No authoritative `codex-p9-bcl-core` continuation lease was established; Project Agent/Lease remain unobserved |

The fresh UI observation is copied without alteration to `red-black-readiness/project9-readiness-ui-observation.json`. The six original red-black files remain byte-for-byte intact; their earlier observation times are historical provenance. The fresh UI and claim records supplement them.

## Concrete owner requests

| Work | Current owner/contact and issue | Proposed paths | Required action |
| --- | --- | --- | --- |
| Root lock repair for the IO stack | `codex-p19-core`, #2072 | Root `package-lock.json` under `package-json` lock | Integrate the four missing workspace/dependency entries, or coordinate an explicit generation-aware handoff; then run a real clean install and required core checks |
| Boolean structural carrier schema | `codex-p4-abi`, #1062 | `planning/contracts/schema/bytecode-image.v2.schema.json`, `tests/a00-05-metadata.test.js`, schema README | Extend the current narrow scope, review the closed record proposal and qualify structural/semantic responsibilities |
| Boolean typed source-body lowering | `codex-p4-abi`, #1066 | `scripts/planning/schema/lower-method-body.js`, `tests/a00-05-typed-ir.test.js`, `planning/contracts/schema/method-body.md` | Extend scope and lower the centrally validated carrier to existing `load-static` |
| Additive compatibility proof | `codex-p4-planning`, #1101 | `scripts/planning/check-contract-change.js`, `planning/contracts/tests/gates.test.js` | Extend the currently restricted proof scope; qualify the conservative carrier/items rule and reference-context regression |
| Public validator export | Preserved legacy contact `codex-p4-services`, #1043 | `packages/bytecode/src/index.js` | Reconcile preserved ownership and obtain the actual `bytecode-index` lock for the separate one-export prerequisite |
| Truthful canonical readiness snapshot | `codex-p4-planning`, #1093 | `planning/backlog.snapshot.json` and existing snapshot-owner scope if needed | Extend scope, include #2664 and current actual state/evidence, and refresh the snapshot after policy review |
| Narrow inherited-dependency scope | `codex-p4-planning`, #1094 | `planning/contracts/dependency-scopes.json` plus the existing owner policy/test scope | Review the two additive rows for #2664; retain parent, sibling, direct, other ancestor/transitive and contract requirements |

The complete, ready-to-post drafts are in `handoffs/`. Each gives an immutable claim URL, recorded generation, precise paths and requested result. **Replace the publication placeholder before posting.** The drafts request coordination; they do not assert that the current claimant has already approved the new scope. The public-facade contact has preserved legacy keys, while its current active paths cover another narrow follow-up. The atomic `bytecode-index` lock ref being absent does not itself authorize the protected edit.

## Boolean product and contract distinction

The product is published at [d6c6eb24eae3a7116b4bb5497c68b40b90aa3d2c](https://github.com/wieslawsoltes/SharpForge/commit/d6c6eb24eae3a7116b4bb5497c68b40b90aa3d2c), with the same tree `d934a12e448fc825ad49a535ced67a801e98e57c` as measured commit `af29812a6b0ca0184a79cc6bcddd01bf0a02fb6a`. Root reports the published-commit replay passed 316/316 tests, with TAP SHA256 `e353db73377e51ac074235d6e3f4ba8d67cc02ea6db68ecf2a35b4b80b060d52`. The measured branch completed its source/runtime qualification, performance review and size review; this does not complete the unimplemented portable-source structural and typed-body prerequisites.

The A00 combined patch is still **unapplied**, based on the same source tree at `af29812a6b0ca0184a79cc6bcddd01bf0a02fb6a`, SHA256 `61970b65da7d2dbadb166f1c266bd336b258403a83ba17f04a7195aa68658b2e`. Static review accepted the current proposal; the owners still need to apply and qualify it through their actual scopes. Four disjoint split patches are supplied. Suggested dependency order is public facade, compatibility gate, structural schema, typed-body adapter, then combined qualification. Applicability of a split patch does not imply that its tests run independently of the other prerequisites.

The 47-path product audit is in `boolean-a00/boolean-path-ownership-mapping.json`. It establishes exact manifest/diff and blob/hash equality, zero changed protected-lock paths and 60 unchanged hot/public-facade paths. It also lists 13 paths outside registered area write/evidence globs. **Path safety is separate from task ownership:** neither this audit nor an absent task ref establishes a Project Agent, lease, readiness or scope transfer. See `boolean-a00/product-ownership.md`.

#783 remains open for the Boolean methods and broader Object/ValueType acceptance. This field prerequisite does not claim the full leaf, current-main integration, Rust execution, Rust structural-reader parity or neutral typed-IR backend qualification.

## Why the ordinary claim path is not available yet

The checked-in `Claims.claim` implementation checks the actual Project item before creating a ref: Status must be Ready; Agent must be empty; the item must be an open leaf with no children; there must be no authoritative claim; and the readiness callback must accept the canonical snapshot. The readiness gate requires a fresh snapshot (at most 24 hours), valid dependency graph, actual closed/merged-main evidence for effective prerequisites, and qualification for named contracts. The recorded canonical snapshot is dated 2026-10-03 12:55:45.654 UTC, contains 1,381 issues and omits #2664.

The ref creation is the claim's linearization point only **after** those preconditions. A later Project projection failure does not waive the initial Ready check. The package claim's custom `projectProjection` note is not a supported new claim mode. The existing CLI defaults to Project #4, so a legitimate Project #9 operation must explicitly target Project #9 through supported tooling after the required state exists.

For #2664, current code supplies the internal heap-owned algorithm seams despite broader parent epics retaining unrelated work. The proposal therefore isolates only the parent-to-child inherited prerequisites that the internal core does not use. It does not manufacture closed evidence for those parent epics or make the task Ready by itself. After owner reconciliation, merge the policy, refresh the truthful canonical snapshot, pass the unchanged readiness gate, obtain the actual Ready/empty-Agent Project state, and only then claim and implement the complete internal core.

## IO publication and installation

The final local IO qualification and published eight-PR stack are documented in `io/README.md`. Immutable full IO evidence is already published at [c890bec08d53bf08295a36d67874a49f26672c8b](https://github.com/wieslawsoltes/SharpForge/tree/c890bec08d53bf08295a36d67874a49f26672c8b/evidence/project9/io-qualified). Historical `io/publication/` files contain preparatory “publication pending” text; those exact bytes are preserved and are superseded on publication status by the fresh records. They remain valid provenance for the prepared commits and qualification artifacts.

The root package patch is a 1,368-byte unapplied patch with SHA256 `8a5dbf77311a81382eef091968b06dfa77be0920385f8eb49dcd2ea6652b230b`. Its captured base lock SHA256 is `0795c3e9cb2007594de2fa207c2a97d80bb927f146f68d8566934485cbddf0cd`. Integrate it on the oldest IO branch that introduces the workspace, then merge it through the stack. Do not apply it to the Boolean branch simply because that branch has the same pre-IO lock bytes. See `root-package/README.md` for the four exact missing entries and install evidence.

## Integrity and publication

`copied-files.json` records the original path, destination, size and SHA256 for every byte-preserved source copy. Current claims are normalized JSON copies of immutable GitHub claim contents; their provenance is in `claims/observations.json`. The final `manifest.json` describes this bundle and its generated files. `SHA256SUMS` covers every file except itself. No build outputs, package payloads or repository checkouts are duplicated here.

All new files live under the ignored artifact directory. This handoff performed read-only GitHub lookups and local text/hash/copy operations. Root alone owns qualification execution and publication; no issue handoff has been sent.
