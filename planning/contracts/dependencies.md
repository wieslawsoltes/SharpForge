# Ownership and dependency gates

A task declares `Depends on: SF-A00-T01, SF-A00-T02` or a multiline bullet list.
`Requires contracts: value-abi@1` names an exact qualified contract version.
The legacy `## Dependencies` section's work-ID links are also parsed. Malformed
IDs and conflicting contract versions fail. Parent dependencies apply to each leaf;
parent completion is not itself a dependency of its own children.

A task is ready only when it is an open leaf, the dependency graph has no cycles or
missing IDs, all transitive requirements are CLOSED with a merged PR targeting the
repository default branch and a recorded merge commit, and each required contract
has `{version, qualified: true, commit}` in the supplied registry. Closed-but-unmerged
and draft/unmerged PRs remain blocked. The project Status field alone is insufficient.
Claims require a snapshot no older than 24 hours. Snapshots must be refreshed after
merges/reopens; a snapshot is point-in-time evidence, not an API transaction.

```sh
node scripts/planning/snapshot-backlog.js
node scripts/planning/validate-dag.js
node scripts/planning/ready.js --task SF-A00-T07.3
node scripts/planning/dag-export.js
node scripts/planning/gen-ownership.js
node scripts/planning/gen-codeowners.js
node scripts/planning/check-ownership.js --area A00 --base origin/main --locks studio
node scripts/planning/check-hot-files.js --base origin/main --locks studio
node scripts/planning/bootstrap-project.js --dry-run
node scripts/planning/lint-backlog.js
node scripts/planning/check-path-collisions.js
```

The ownership catalog is extracted from each area's E01 issue. Tests and manifests
have explicit per-area evidence paths. Exceptions are enumerated, never inferred
from an extension or a generated filename. Shared hot-file locks are required even
when the broad area glob contains that file. The checker's `--locks` input must come
from validated current claim ownership in CI; an untrusted PR must not choose its
own held-lock list. Runtime lease verification is supplied by the claim tools.
Generated CODEOWNERS uses the repository owner until real area teams are configured;
placeholder team names are comments so GitHub never silently ignores nonexistent owners.

The path-collision detector is conservative for wildcard intersections; a warning
requires splitting paths or declaring a shared serialization lock. It does not allow
two agents to hold the same key simultaneously. Backlog linter reports violating
issue numbers; it never fabricates missing acceptance text or silently repairs issues.

Project bootstrap defaults to dry-run. `--apply` creates missing fields and labels;
a second run is a no-op. Existing incompatible field types fail without mutation.
Views require the listed manual UI configuration because the API does not create them.

Node 22+ is the supported execution target. Test fixtures simulate API responses;
they are not native runtime or browser qualification. The snapshot records real
GitHub merged states and may accurately contain unready or malformed backlog items.
