# Draft for issue #1094: review two additive inherited-dependency rows for #2664

**Not posted.** Destination: https://github.com/wieslawsoltes/SharpForge/issues/1094

For `codex-p4-planning`, the claimant recorded for `refs/heads/agent/SF-A00-T09.3`. Please review this concrete coordination request; the prepared artifacts have not been applied to your reserved files.

Evidence bundle: [[BLOCKED_PREREQUISITES_BUNDLE_URL]]

## Observed ownership

The 2026-10-04 17:42:34 UTC ref refresh still points to [claim commit 90b232153afde795614096570090a96a2dee6f9c](https://github.com/wieslawsoltes/SharpForge/blob/90b232153afde795614096570090a96a2dee6f9c/claim.json), generation `bcb8e1ee-0e51-47fa-a013-b29a82153c90`, with recorded expiry `2026-10-05T08:59:56.877Z`. The normalized exact-commit claim is retained in `claims/claim-SF-A00-T09.3.json`. This observation does not extend the current scope, transfer ownership, or release a lock.

## Technical reconciliation

Issue #2664 / SF-A08-T04.1 specifies an internal heap-owned red-black core shared by sorted collections. Existing merged package/platform, precise heap roots, snapshot and synchronous callback/cancellation seams can support opaque managed values and an explicit host comparison policy. The leaf need not add managed collection registration or C# generic public binding. The broader sorted-collection parent still needs those contracts for its public APIs.

The exact proposal red-black-readiness/proposal.json contains only two additive exceptions at child SF-A08-T04.1 / parent SF-A08-T04 / sourceIssue2664: the inherited SF-A00-T02 registry prerequisite and SF-A02-T02 compiler-binding prerequisite. Append reviewed rows to the existing policy; do not replace the file, broaden the boundary or edit parent/sibling requirements. Proposal SHA256: `3dfb7b2fc504e47c8ffc985f1f11d1d63fd6f2c3459a3f59d16cb6ccdbbd0c78`.

## Requested action

Please reconcile this new semantic scope with your current #425 release-scope authorization, review both reasoned exceptions and add focused policy tests/documentation through the existing active paths: validate-dag.js, ready.js, dependency-scopes.json, dependencies.md and dependency-scopes.test.js. Preserve own/direct, other ancestor/transitive and all named contract requirements.

Coordinate a truthful canonical snapshot refresh with #1093, then use the unchanged readiness gate and actual Project fields. The fresh UI still shows #2664 Backlog and zero Ready items; the proposal is not a task claim or qualification. The full leaf remains unimplemented: insert/delete/find, min/max, forward/reverse versioned traversal, range views, GC-visible nodes and the stated randomized invariant acceptance remain future implementation work.

## Requested result

Please record the agreed scope or generation-aware handoff through the existing coordination process, then provide the exact implementation or policy PR, merge SHA and qualification evidence. Recheck the live authoritative record before acting. No claim, Project field, issue or protected file was changed while preparing this request.
