# Red-black tree readiness handoff — #2664

**Unapplied proposal.** This directory records the exact planning coordination needed before claiming `SF-A08-T04.1`. It does not change planning policy, grant ownership, move a Project item, or qualify an implementation.

## Current status

- Root's live Project #9 UI inspection found one row for issue #2664 with **Status Backlog**.
- Root's separate Ready view (view 3, saved filter `status:Ready -kind:Epic`) displayed **0 matching items**. The browser was signed out; no Project edit or authentication was attempted. Exact UI observation time was not retained.
- Fresh connector issue searches at **2026-10-04 16:43:03 UTC** returned **300 open and 11 closed Project #9 issues**, both with `incomplete_results: false`. These are issue-state counts; they do not mean all remaining work is technically blocked.
- A fresh read of `refs/heads/agent/SF-A08-T04.1` returned 404. An absent claim ref does not prove the Project Agent field is empty or the item is Ready.
- The proposed tree is **unimplemented and unqualified**. Its narrow implementation can use merged primitives, but its formal readiness preconditions remain unmet.

Sources: [Project #9](https://github.com/users/wieslawsoltes/projects/9), [issue #2664](https://github.com/wieslawsoltes/SharpForge/issues/2664), [parent #119](https://github.com/wieslawsoltes/SharpForge/issues/119). Root supplied the live UI observations; the connector supplied fresh issue-state counts and claim records.

## Files

| File | Purpose |
| --- | --- |
| `proposal.json` | Exactly two additive entries for the existing policy's `exceptions` array. It is an array of proposed entries, **not a replacement policy file**. |
| `claim-SF-A00-T09.2.json` | Complete canonical-snapshot owner's claim record read at its immutable claim commit. |
| `claim-SF-A00-T09.3.json` | Complete dependency-policy owner's claim record read at its immutable claim commit. |
| `provenance.json` | Retrieval context, owner refs and generations, evidence URLs, source-file SHA256 and Git blob/commit IDs. |
| `SHA256SUMS` | Content hashes for this handoff's files, excluding the checksum file itself. |

## Required owner coordination

| Responsibility | Current authoritative reservation |
| --- | --- |
| Policy/readiness | `codex-p4-planning`, #1094 / `SF-A00-T09.3`, branch `codex/a00-dependency-scopes`, generation `bcb8e1ee-0e51-47fa-a013-b29a82153c90`, expires `2026-10-05T08:59:56.877Z`. |
| Canonical snapshot | `codex-p4-planning`, #1093 / `SF-A00-T09.2`, branch `codex/a00-release-snapshot`, generation `117718c3-53f8-4e13-9f93-50ddec0e9906`, expires `2026-10-05T08:43:57.750Z`. |

The policy claim reserves `planning/contracts/dependency-scopes.json`, `dependencies.md`, `tests/dependency-scopes.test.js`, `scripts/planning/validate-dag.js`, and `ready.js`. The snapshot claim reserves `scripts/planning/snapshot-backlog.js`, `planning/contracts/tests/governance-snapshot.test.js`, and `planning/backlog.snapshot.json`.

Both records remain live reservations. Their existing authorization concerns earlier release-scope work, so this new #2664 correction requires the owner's scope extension or explicit handoff. Expiry alone would not release either reservation.

## Exact proposed scope

Append the two records in `proposal.json` to the existing `exceptions` array only after the planning owner reviews and approves their basis:

1. At child `SF-A08-T04.1` / parent `SF-A08-T04`, omit inherited `SF-A00-T02` (#5): this internal heap-owned tree adds no managed collection type or member registration and uses the existing public package seam.
2. At the same boundary, omit inherited `SF-A02-T02` (#33): opaque managed values and an explicit synchronous host comparator require no C# generic binding or public generic collection API.

Both records name source issue 2664. They retain parent #119, its broader prerequisites, and every sibling's requirements. Direct dependencies, requirements from other ancestors, independent transitive routes, and all mandatory named contracts remain enforced. This is the existing policy mechanism, introduced in [3ca460d1](https://github.com/wieslawsoltes/SharpForge/commit/3ca460d1bdd016a91ff044f833c40ddfbb08fa7a); no claim/readiness algorithm change is proposed.

Do not close #5 or #33 to make this leaf pass. Their remaining acceptance is broader than the internal tree's contract.

## Existing implementation prerequisites

Static assessment used merged main `00c2489e659cbeaa29e9c5dfa4a3137fae4bd4ad`. The writer evidence worktree was clean at `fe8288772be85395909d5de582c444db3d605ca3` when source hashes were captured.

| Required capability | Existing seam and evidence |
| --- | --- |
| Package export | `packages/bcl-collections/package.json` exposes `src/index.js`; the proposed internal core needs no managed method IDs or framework registration. |
| Managed tree/node records | `ManagedPlatform.make/record/get/set` and `ManagedHeap.allocate/get/replaceData` support fixed-layout records with managed child/payload references. |
| GC and roots | `heap-collection.js` traces all non-string record data; `withRoots` and managed handles support temporary and host roots. |
| Observer allocation lifetime | `heap.js` and `execution/heap-allocation.js` retain new records and one-shot explicit roots through synchronous allocation notifications, merged through PR #4562. |
| Snapshot state | `ManagedHeap.snapshot/restore` copies record arrays and handles; tree/view/iterator authority can remain managed rather than hidden in host generators. |
| Explicit stop | `bclHost.isExecutionStopped` distinguishes explicit VM stop from natural completion; HashSet's committed reentry tests cover this lifecycle distinction. |
| Synchronous comparison | `bclHost.invokeSynchronousHostCallback` and snapshot-boundary guards are merged through PR #4567. |

Existing qualification sources: [HashSet #4562](https://github.com/wieslawsoltes/SharpForge/pull/4562) and [Stopwatch #4567](https://github.com/wieslawsoltes/SharpForge/pull/4567). Their qualification does not qualify the proposed tree. No tests, builds, installs, benchmarks, native programs or CI were run for this handoff.

The local implementation must compare and preallocate before publishing a complete fixed-slot rotation/root/count/version change, then issue rooted notifications. It must revalidate after callbacks, retain nested mutations, distinguish explicit stop, and keep every observable tree valid. `platform.set` between individual rotation links would expose an invalid intermediate graph. This is work to implement and test, not a missing cross-workstream seam.

The complete leaf still includes insert/delete/find, min/max, forward/reverse versioned iteration, live range views, GC-visible nodes, and invariant verification after each of 100,000 deterministic random operations. Native ordering/range traces would validate observable results, not internal tree balancing or SharpForge observer policy.

## Claim preconditions and execution path

1. The planning owner reviews the two scoped entries and prerequisite evidence, extends its own scope appropriately, and merges the narrow policy correction with focused regression evidence.
2. The snapshot owner performs a truthful refresh including #2664, complete ancestry, and real dependency/merge evidence. The current committed snapshot is dated `2026-10-03T12:55:45.654Z`, contains 1,381 work items, and omits #2664. The separate Project #9 inventory has a different shape and is not the canonical readiness input.
3. Run the unchanged `requireReady` hook against a fresh canonical snapshot. It requires age <=24 hours, a valid complete DAG, an open leaf, closed-and-merged default-branch evidence for each effective dependency, and exact qualified records for every mandatory named contract.
4. After readiness succeeds, the planner moves the actual Project item from Backlog to Ready. Recheck Project Agent, native subissues and the authoritative claim ref immediately before claiming.
5. Use the normal claim path with `--project 9` explicitly; the CLI defaults to Project 4. A valid implementation branch can be `codex/a08-red-black-tree-core`.

If owners record named contract requirements for the actual seams, use existing real names, versions and retained qualification evidence. Do not invent names or `qualified: true` values to force readiness. No new mandatory contract names are asserted by this handoff.

`Claims.claim` checks actual Project fields and its readiness callback before the atomic claim-ref creation. There is no supported projection-unavailable or claim dry-run mode. A later failed Project projection preserves an already valid claim; it does not waive the initial Ready check.

The connector exposes no Project-field or arbitrary GraphQL API. Root's signed-out browser view provides read evidence only. A normal claim needs an authorized Project-capable channel or planning-owner participation. This handoff does not assume or acquire that capability.

## Source hashes and limitations

- Existing dependency policy SHA256: `2335b7c4206481dae5b99a819877d31d66b97feeee430af6f234482cbe98e100`.
- Existing canonical snapshot SHA256: `b4ad3fba206f4d511308273303904a69e7609f5b89e5290bcbb895559fdc91f5`.
- `provenance.json` records current SHA256, Git blob IDs at the writer head and assessed main, last-change commits, and GitHub source links for 24 relevant files.
- The two owner snapshots were fetched by immutable claim commit after reading their current refs. Current ownership must be checked again before any later work.
- This directory is ignored by the repository's existing `artifacts/` rule. No tracked planning file, claim, Project field, issue, comment, or product file was modified.

