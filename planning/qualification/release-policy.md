# Stable contracts and preview release policy

Task SF-A29-T11 (#407), leaves #1185–#1190. This policy separates durable SharpForge
contracts from changing C# 15 proposals, .NET preview SDKs and Windows App SDK
previews. A stable package version does not claim complete C#, BCL, CLR or WinUI
parity. Shipping an opt-in experiment does not make its behavior a stable contract.

## Contract identity and promotion

The authoritative identities remain in `planning/contracts/spec-revisions.json`,
`versions.json` and the framework/bytecode ID locks. Native tool and reference
assembly bytes remain pinned by `planning/qualification/oracle-toolchain.json`.
The release-policy input lock references these existing sources instead of creating
another language version or ABI namespace. Existing revision IDs cannot change
meaning, even with approval: a changed specification requires a new revision ID.

**Blocking gate:** `node scripts/conformance/release-policy/check-policy.js`.
It compares actual inputs with their frozen integration baseline, checks explicit
current hashes and rejects a rewritten/deleted specification identity. Changed
inputs require an entry in `release-policy/reviews.json`, keyed by the exact
reported change digest, naming a merged main PR and reviewed commit. GitHub must
confirm the same source bytes and an approval on that exact commit by a distinct
human repository administrator or maintainer. A later request for changes or a
self-authored `approved: true` file is not approval. Missing API access or review
information fails closed. Never put an API token in a policy file or report.

Review must cover the specification/API diff, backward compatibility, stable ID
preservation, required tests and independent platform/engine evidence. Updates
must not relabel earlier evidence with a new specification revision. The watcher
opens a review issue only; it does not edit pins, code, project status, capability
inventories, release versions or qualification results. Closing its issue is not
an approval token. The normal contract-change gate still applies to ABI changes.

Preview features require explicit `LangVersion=preview`. `default`, `latest`,
`latestmajor`, C#14 and numeric `15` do not opt in. Current parser/compiler support
covers only a selected profile. Opt-in admits testing an experiment; unsupported
features remain rejected and unknown targets remain unqualified. The policy's
five-row preview projection records the exact published T03 inventory commit,
whole-inventory digest, immutable spec links and original probe bytes. Once the
shared inventory exists in the checkout, additions, omissions or changed probe
identities require reconciliation; no preview row is silently omitted.

A preview identity is never renamed into a stable identity. Adopting a finalized
feature requires a new stable revision, explicit maintainer review, stable-version
negative/positive boundaries and fresh independent target evidence. Updating a
SDK feed or changing an implementation flag cannot grant that evidence.

## Versions and deprecation

Release tags are `vMAJOR.MINOR.PATCH` or explicit prerelease versions such as
`v0.15.0-preview.1`. Root package.json, every workspace package selected by
`packages/*` in the release checkout, and one nonempty CHANGELOG section must
agree exactly. The workspace inventory must be nonempty; every package directory,
manifest, unique name and version is checked. Build metadata aliases, duplicate release
sections, leading-zero numeric versions and mismatched workspace versions fail
`scripts/conformance/release/version-check.js` before reused CI starts.
Prerelease tags create prereleases; stable tags never promote a preview capability.

A compatible bug fix increments PATCH. A backward-compatible API addition
increments MINOR. An incompatible stable API/behavior or serialized-contract
change requires MAJOR, or MINOR while the package major version is zero, plus the
existing contract-version gate and explicit compatibility review. Numeric ABI,
framework and opcode identifiers are never recycled. Preview APIs may change only
under their own versioned preview revision and changelog entry.

Before removing a stable API, mark it deprecated with a documented replacement,
keep it available through at least one subsequent MINOR release, and name the
first eligible breaking release in the changelog. Security exceptions require a
reviewed rationale and migration guidance; they do not permit silent ID reuse.
No automatic watcher performs version bumps, deprecation or capability promotion.

## Draft and manual publication boundary

The tag workflow runs policy/version checks, calls the existing reusable CI,
verifies producer seals, packages the qualified bytes deterministically, produces
a full SBOM, signs all release subjects and retains the Sigstore proof bundle.
A separate least-privilege job creates a **draft** containing every payload,
SOURCE-MANIFEST, SHA256SUMS, SBOM and proof bundle. Missing digests, partial uploads,
unexpected assets or an already-published release stop this process.

Only the `publish` job references the **release** environment. Repository admins
must configure required human reviewers, prevent self-review and disable admin
bypass. The preflight queries this configuration and fails if it is absent. This
is necessary because merely naming a new environment can create an unprotected
one. The publisher checks recorded approval for its exact workflow run, then
rechecks the exact draft asset digests, source identity, GitHub signatures and
attached Sigstore bundle before changing the draft flag. It never rebuilds assets.
Any failing reused CI job prevents both draft creation and publication.

See GitHub's [environment protection documentation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
and [environment API](https://docs.github.com/en/rest/deployments/environments).
No environment, release, approval or repository setting was created by implementing
this policy. Until the protected environment exists, tag publication remains blocked.

## PR previews and trust

The existing ordinary PR core build uploads its dist plus a manifest binding the
merge SHA, PR head SHA, run ID/attempt and each file digest. It is a seven-day
artifact, not a deployment, release or parity report. Production Pages remains
main/manual-only and unchanged. There is no additional automatic PR build or job.
The optional `preview.yml` manual locator provides a link to the exact successful
PR run's retained artifact using read-only API calls.

Fork PR artifacts remain untrusted data. The locator never downloads, extracts,
executes or deploys their contents and never receives write permissions. Artifact
names are bound to the CI run and attempt; missing, expired, duplicate or unsealed
artifacts fail. Preview artifacts are never substituted for tag-qualified release
assets or used by privileged release jobs.

Implementation commands, evidence limits and the six-leaf handoff are in
[the release-policy guide](release-policy/README.md).
