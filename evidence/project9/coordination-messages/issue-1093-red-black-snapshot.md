# Project #9 coordination: refresh truthful readiness evidence for the internal tree leaf

For `codex-p4-planning`, the claimant recorded for `refs/heads/agent/SF-A00-T09.2`. Please review this concrete coordination request; the prepared artifacts have not been applied to your reserved files.

Evidence bundle: https://github.com/wieslawsoltes/SharpForge/tree/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/blocked-prerequisites

## Observed ownership

The 2026-10-04 17:42:34 UTC ref refresh still points to [claim commit 3fda2d3b02640332e8ad8aeee864e4b1063a9032](https://github.com/wieslawsoltes/SharpForge/blob/3fda2d3b02640332e8ad8aeee864e4b1063a9032/claim.json), generation `117718c3-53f8-4e13-9f93-50ddec0e9906`, with recorded expiry `2026-10-05T08:43:57.750Z`. The normalized exact-commit claim is retained in `claims/claim-SF-A00-T09.2.json`. This observation does not extend the current scope, transfer ownership, or release a lock.

## Actual state and prepared scope

Issue #2664 / SF-A08-T04.1 is the complete internal red-black core leaf. It remains unimplemented and unqualified. Root's fresh public Project #9 UI at 17:45:41 UTC shows exactly one matching row, open/Backlog, and the Ready queue view (status:Ready -kind:Epic) contains zero items. Agent and Lease fields were not visible. The task's authoritative claim ref is absent.

The current canonical planning/backlog.snapshot.json is dated 2026-10-03T12:55:45.654Z, has 1,381 issues and omits #2664. That snapshot cannot meet the ordinary freshness/leaf checks for this work. The six preserved red-black files and fresh UI observation are in red-black-readiness/.

## Requested action

Please explicitly extend your currently narrow snapshot scope to a truthful refresh covering #2664, after coordinating #1094's two-row inherited-dependency proposal. Your active paths are scripts/planning/snapshot-backlog.js, planning/contracts/tests/governance-snapshot.test.js and planning/backlog.snapshot.json; preserve unrelated rows, statuses, evidence and sibling reservations except changes supported by actual upstream observations.

Record actual Project state and prerequisite merge/qualification evidence. Do not synthesize closed parent-epic evidence or mark the leaf Ready merely because the internal algorithm can use current seams. After policy and snapshot review, run the unchanged readiness gate; only a legitimate actual Ready/empty-Agent Project item can proceed through Claims.claim. The CLI must explicitly target Project #9 because its default is Project #4.

## Requested result

Please record the agreed scope or generation-aware handoff through the existing coordination process, then provide the exact implementation or policy PR, merge SHA and qualification evidence. Recheck the live authoritative record before acting. No claim, Project field, issue or protected file was changed while preparing this request.
