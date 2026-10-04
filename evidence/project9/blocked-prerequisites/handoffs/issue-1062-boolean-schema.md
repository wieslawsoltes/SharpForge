# Draft for issue #1062: qualify the readonly-field structural carrier

**Not posted.** Destination: https://github.com/wieslawsoltes/SharpForge/issues/1062

For `codex-p4-abi`, the claimant recorded for `refs/heads/agent/SF-A00-T05.1`. Please review this concrete coordination request; the prepared artifacts have not been applied to your reserved files.

Evidence bundle: [[BLOCKED_PREREQUISITES_BUNDLE_URL]]

## Observed ownership

The 2026-10-04 17:42:34 UTC ref refresh still points to [claim commit 2021a5004e46f3ac0824ae8f679725fa499cd266](https://github.com/wieslawsoltes/SharpForge/blob/2021a5004e46f3ac0824ae8f679725fa499cd266/claim.json), generation `9f3aa8c7-c0b4-4630-8f85-6ef0a7f1ac05`, with recorded expiry `2026-10-05T07:13:08.876Z`. The normalized exact-commit claim is retained in `claims/claim-SF-A00-T05.1.json`. This observation does not extend the current scope, transfer ownership, or release a lock.

## Concrete change and scope

The Boolean TrueString/FalseString product emits a closed readonlyField constant carrier with canonical owner/name. Its source/runtime tests pass, but the current bytecode-image.v2 structural schema rejects the object carrier. The unapplied three-file patch is `boolean-a00/boolean-a00-schema-owner.patch`, SHA256 `540d156c853ad4b4b15c4b017c397dcbd85b618c1a89baf0d5960ed61737fb52`.

Proposed paths:

- planning/contracts/schema/bytecode-image.v2.schema.json
- tests/a00-05-metadata.test.js
- planning/contracts/schema/README.md

The current active authorization only refreshes planning/contracts/example-schema-coverage.json; its preserved legacy schema/test keys are not an already-approved extension for this new work. Please reconcile the new scope explicitly.

## Requested action

Review and apply the closed carrier with nonempty owner/name strings. Keep static default slots primitive. Leave NUL checks, canonical identity and UTF-16 owner/name limits to the shared semantic validator, as the authored structural-acceptance/semantic-rejection tests demonstrate. Preserve the exact primitive validation node budget.

Coordinate with #1101's conservative additive gate proof, #1043's separate protected public-validator export and #1066's existing load-static adapter. The owner should qualify the integrated structural and semantic contract, and separately record any Rust-reader/backend limits. The proposed patch was statically reviewed but has not been applied or executed; no schema/version compatibility conclusion is being substituted for owner qualification.

## Requested result

Please record the agreed scope or generation-aware handoff through the existing coordination process, then provide the exact implementation or policy PR, merge SHA and qualification evidence. Recheck the live authoritative record before acting. No claim, Project field, issue or protected file was changed while preparing this request.
