# Project #9 coordination: reconcile the IO workspace in the root lock

For `codex-p19-core`, the claimant recorded for `refs/heads/agent-locks/package-json`. Please review this concrete coordination request; the prepared artifacts have not been applied to your reserved files.

Evidence bundle: https://github.com/wieslawsoltes/SharpForge/tree/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/blocked-prerequisites

## Observed ownership

The 2026-10-04 17:42:34 UTC ref refresh still points to [claim commit d538f55223dd3fcfcd234e170af8a166da81ad86](https://github.com/wieslawsoltes/SharpForge/blob/d538f55223dd3fcfcd234e170af8a166da81ad86/claim.json), generation `8f3f406a-3f3e-4ea7-ac65-258a5b41afe9`, with recorded expiry `2026-10-04T20:04:09.592Z`. The normalized exact-commit claim is retained in `claims/claim-package-json.json`. This observation does not extend the current scope, transfer ownership, or release a lock.

## Concrete change and reason

The eight existing Project #9 IO drafts (#4509, #4510, #4513–#4517 and #4542) are published, but their exact heads all have a failed core check. Original job/step evidence and the retained local clean-install log show the missing root lock entries for @sharpforge/bcl-io@0.14.0. The local product/benchmark/package qualification is complete; a real clean source install remains blocked.

The reviewed local patch `root-package/project9-package-lock.patch` changes only root package-lock.json: it adds the node_modules workspace link, the packages/bcl-io workspace record, and the framework/runtime lock dependencies. SHA256: `8a5dbf77311a81382eef091968b06dfa77be0920385f8eb49dcd2ea6652b230b`. Its exact captured base lock SHA256 is `0795c3e9cb2007594de2fa207c2a97d80bb927f146f68d8566934485cbddf0cd`.

## Requested action

Please review and integrate those four entries under the package-json lock, starting on #4509's branch where the IO workspace is introduced, or explicitly coordinate the proper generation-aware lock handoff. Reconcile against current source/manifests and preserve your unrelated work; merge the repair upward through the existing stack. I can then run a real npm ci and required checks on the exact resulting heads before draft promotion.

The lock registry protects both root package.json and package-lock.json. The current record's empty locks array and package-local paths do not constitute release of the actual agent-locks/package-json ref. Its custom Project-projection note is not a supported bypass of ordinary claim preconditions. This request does not change that record or apply the patch.

## Requested result

Please record the agreed scope or generation-aware handoff through the existing coordination process, then provide the exact implementation or policy PR, merge SHA and qualification evidence. Recheck the live authoritative record before acting. No claim, Project field, issue or protected file was changed while preparing this request.
