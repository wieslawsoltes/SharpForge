# Project #9 coordination: lower the source field carrier through load-static

For `codex-p4-abi`, the claimant recorded for `refs/heads/agent/SF-A00-T05.5`. Please review this concrete coordination request; the prepared artifacts have not been applied to your reserved files.

Evidence bundle: https://github.com/wieslawsoltes/SharpForge/tree/89b799336f5a1af8b79d463783aa2932478cd78c/evidence/project9/blocked-prerequisites

## Observed ownership

The 2026-10-04 17:42:34 UTC ref refresh still points to [claim commit 03d5edf10750530446a26031760da8af27c7696c](https://github.com/wieslawsoltes/SharpForge/blob/03d5edf10750530446a26031760da8af27c7696c/claim.json), generation `59c1a235-3afb-4a50-af39-461867e6ea68`, with recorded expiry `2026-10-05T05:50:33.634Z`. The normalized exact-commit claim is retained in `claims/claim-SF-A00-T05.5.json`. This observation does not extend the current scope, transfer ownership, or release a lock.

## Concrete change and scope

The current neutral source typed-body adapter does not lower the Boolean readonlyField constant carrier. The unapplied proposal `boolean-a00/boolean-a00-typed-body-owner.patch` has SHA256 `da0629c206a6b7afbe715d007c74a0e77afd65bdc58b726767345697418236e3` and changes:

- scripts/planning/schema/lower-method-body.js
- tests/a00-05-typed-ir.test.js
- planning/contracts/schema/method-body.md

The current active claim covers adapters.js and typed-IR tests for a prior return/slot-address follow-up. It preserves wider legacy ownership, but that is not an explicit authorization for this new lowerer scope. Please reconcile the scope with your existing work.

## Requested action

After the separate #1043 public-facade prerequisite, reuse the central validator through the public bytecode entry point and lower the source carrier to the existing load-static descriptor. Preserve zero consumed inputs, one ref:System.String output, exact canonical owner/name/storage and an existing operand-stack prefix. The proposed tests reject malformed/getter/inherited/function/alias/nonstring carriers; no new opcode or ID is needed.

Coordinate with #1062's structural schema and #1101's compatibility proof, then qualify the integrated contract. Product source serialization/runtime roundtrips alone do not establish this typed-body contract or neutral backend execution. All proposal files remain unapplied; #783 remains open for its other methods and Object/ValueType scope.

## Requested result

Please record the agreed scope or generation-aware handoff through the existing coordination process, then provide the exact implementation or policy PR, merge SHA and qualification evidence. Recheck the live authoritative record before acting. No claim, Project field, issue or protected file was changed while preparing this request.
