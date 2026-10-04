# Release policy implementation and qualification handoff

Task SF-A29-T11, parent #407, leaves #1185–#1190. This branch is stacked on
`codex/a29-supply-repro-integration` at `1b1a85d1d26f9e13c8d2bbbb8dbe034fa58a97b8`
(PR #3192). The [policy](../release-policy.md) defines stable/preview contracts,
explicit review, semantic versions, deprecation and privileged release boundaries.

## Commands for the later validation batch

Use the reviewed Node 24.21.0/npm 11.19.0 toolchain and the existing hash-pinned
qualification Python environment. These commands were written, not run during this
implementation, following the user's direction to defer validation to the larger
epic. Commit all source before collecting evidence.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/conformance/release/version-check.js --tag v0.14.0
node scripts/conformance/release-policy/check-policy.js
node --test tests/conformance/release-policy/*.test.js tests/conformance/policy/preview-gating.test.js
python -m unittest discover -s tests/conformance/supply -p 'test_*.py'
python scripts/conformance/supply/workflow-lint.py
node scripts/conformance/supply/pin-actions.js
npm run check
npm test
npm run build
```

For a runnable opt-in example, use the real CLI:

```sh
node apps/cli/main.js run planning/qualification/release-policy/examples/preview-collections.cs --lang-version preview
node apps/cli/main.js run planning/qualification/release-policy/examples/preview-collections.cs --lang-version 14
```

The first command is intended to print `20` and `3`; the second must reject the
proposal with the preview diagnostic. Neither command has been run at this new
revision. Fixtures separately execute the selected preview profile with source
and direct CIL VMs and dispose each VM. They do not simulate native CLR success.

Read-only upstream observation is available with
`node scripts/conformance/release-policy/spec-watch.js`; it reports proposed
review issues without writing. The scheduled/manual watcher alone adds
`--write-issues`. Do not execute release mutation commands as local validation.
The `release.js` draft/publish commands require an explicit `--execute` flag and
an authorized GitHub tag workflow, and the publisher additionally requires the
protected environment's real recorded approval.

## Complete implementation, explicit qualification gaps

| Leaf | Implementation | Evidence status |
| --- | --- | --- |
| #1185 | Stable/preview policy; immutable registry check; exact remote maintainer review | Implemented, new tests not run |
| #1186 | All five pinned preview rows have opt-in admission and stable rejection tests; supported rows have compiler and VM acceptance tests | Three unsupported compiler proposals have explicit skipped positive tests; no full-feature or native qualification |
| #1187 | Three official upstream feeds; bounded requests; deterministic issue marker; serial watcher; closed/open issue deduplication | Simulated issue API fixtures written, never described as live issue creation |
| #1188 | Tag, root, every workspace version and changelog agreement before reusable CI | Positive, malformed, empty/missing workspace, added-package version and cancellation fixtures written |
| #1189 | Reused CI; all-asset draft; attached Sigstore proof; required environment and recorded manual approval before publish | No draft release, protected environment, hosted attestation or publication executed |
| #1190 | Existing PR core dist artifact/provenance; optional read-only locator; unchanged Pages deployment | No new preview artifact or deployment executed from this implementation |

`capabilities.json` lists the tool APIs and records all unrun platforms/engines
as unknown. Current native Roslyn lacks these frozen C#15 proposals; it is explicitly
unsupported for this positive reference acceptance, rather than marked passing.
Unions, closed hierarchies and extension indexers remain unsupported compiler
acceptance cases. Their tests stay visible and skipped, and policy opt-in does not
turn those missing implementations into passing claims. #1186 cannot be closed
until those compiler acceptance criteria and the independent target checks exist.

The preview projection uses T03 commit
`b8b2eab7203317b42b7fc92976d5d582c18b3c62`; its `source.sha256` binds the full original
language inventory and each copied probe retains its original SHA. The referenced
proposal paths are frozen at upstream csharplang commit
`05eb4800fc3dc76259ccd49ac01f1eeb49222380`. No inventory implementation/status field
is imported as passing evidence.

Feed anchors are deliberately separate from observed newest versions and from
native tool qualification. In particular the Windows App SDK GitHub release tag
is a review-feed anchor, not proof that a new package or platform was executed.
A changed feed opens a review item only; reviewed package/reference identities
continue to come from the existing shared pins. No auto-update job mutates them.

The regression files cover duplicate issues, unchanged feeds, malformed/bounded
responses, pagination, cancellation, explicit opt-in, immutable spec IDs, exact
review source/commit, revoked review decisions, version mismatches, empty changelog,
package count, draft identity/digests, self-approval, missing protection rules,
fork artifact data boundaries and expired artifacts. No fixture result is claimed
as a real GitHub approval, signature, release or native platform execution.

These modules run in qualification tooling and add no compiler/runtime hot-path
work. No performance measurement or speedup is claimed; any timing added during
the combined batch must identify its exact commit, host, commands and raw samples.
The combined T08/T09 parent evidence remains revision-specific in
[its integration record](../supply/release-integration.md), and does not qualify
these new gates. All six leaves remain open pending the larger validation stage.
