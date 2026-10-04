# Ownership and dependency gates

A task declares `Depends on: SF-A00-T01, SF-A00-T02` or a multiline bullet list.
`Requires contracts: value-abi@1` names an exact qualified contract version.
The legacy `## Dependencies` section's work-ID links are also parsed. Malformed
IDs and conflicting contract versions fail. Parent dependencies apply to each leaf;
parent completion is not itself a dependency of its own children.

Work IDs use `SF-Axx-Enn`, `SF-Axx-Tnn`, `SF-Axx-Bnn` (or `Rxxx` in place of
`Axx`), optionally followed by one numeric child suffix such as `.2`.
Whitespace, commas, semicolons, colons, parentheses, brackets, backticks,
asterisks, angle brackets, quotes, and exclamation/question marks delimit IDs.
A single sentence-ending period after a complete ID is allowed. Other attached
characters remain part of the candidate and must fail validation: for example,
`SF-A00-T01_2` and `SF-A00-T01/2` must never become `SF-A00-T01`. This applies to
both explicit lists and work-ID links or prose in the legacy Dependencies section.
Inline Markdown links contribute their label only; their URL is not a dependency
declaration, even when its path or query contains a work ID.

A task is ready only when it is an open leaf, the dependency graph has no cycles or
missing IDs, all transitive requirements are CLOSED with a merged PR targeting the
repository default branch and a recorded merge commit, and each required contract
has `{version, qualified: true, commit, path}` in the supplied registry. The CLI verifies that the path exists in origin/main and the qualification commit is an ancestor of that branch; missing files or off-branch commits remain blocked. Closed-but-unmerged
and draft/unmerged PRs remain blocked. The project Status field alone is insufficient.
Claims require a snapshot no older than 24 hours. Snapshots must be refreshed after
merges/reopens; a snapshot is point-in-time evidence, not an API transaction.

```sh
node scripts/planning/snapshot-backlog.js
node scripts/planning/dag.js
node scripts/planning/readiness.js --task SF-A00-T07.3
node scripts/planning/sync-ready.js --dry-run
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

Readiness also includes every transitive dependency ancestor's prerequisites. Missing parents and inherited cycles are errors. Label sync compares current labels and changes only status:ready transitions; invalid graphs cause no writes. Rename checks include both the deleted source and destination. Numeric project fields, including zero parity, are preserved in snapshots.
