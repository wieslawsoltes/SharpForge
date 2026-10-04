# Exact merge-group qualification

The queue context resolver binds explicit repository, queue ref, target ref, head
SHA and base SHA pins to the actual Git commit graph. It reads each queue merge's
second parent and resolves that exact head through GitHub's commit-associated PR
API and current PR endpoint. Queue branch names do not identify constituents.
Every PR must be open, target the pinned repository/branch and still have the
pinned head/base. Labels and task identity come from the API, separately per PR.
The queue ref is checked before and after resolution; drift requires a new run.

The supported graph is a first-parent sequence of two-parent merge commits ending
at the pinned base, with at most 100 distinct constituent heads. Linear, squash,
rebase and octopus histories, ambiguous associated PRs, incomplete API pagination,
missing commits and stale pins fail explicitly. This is a supported-topology
boundary, not a claim about every GitHub merge queue configuration. No hosted
queue configuration or branch protection has been changed.

The saved context can only be consumed on its exact group checkout. Validation
reconstructs the sequence and rejects omitted, reordered or substituted PRs before
any claim lookup or qualification command. Context capture alone is not a passing
combined-tree qualification. The manual `merge-queue.yml` workflow consumes this context while retaining the
existing serial qualification policy.

Regressions use temporary real Git repositories and fake read-only GitHub
responses. They do not establish live GitHub queue topology or token access.

## Manual combined-tree gate

Dispatch `merge-queue.yml` with `head_sha`, `base_sha`, `head_ref` and `base_ref`.
The dispatch revision supplies the trusted harness in `planning-tools/`; the
pinned combined commit is checked out separately in `qualified-group/` with full
history. The resolver runs before dependency installation or candidate commands.
Both checkouts disable persisted Git credentials.

The trusted runner checks each constituent's authoritative task, Project branch,
claim lease and lock generation. The pinned base supplies ownership/hot-file
policy. Both the constituent's own diff and its actual contribution from the
previous queue tree must obey that PR's claim; merge-resolution edits cannot
escape ownership review. Contract changes and seam locks are likewise reviewed
on both diffs, using only that PR's API labels. Labels and locks are never pooled
across the group. Duplicate contract IDs in the actual combined commits fail
before any candidate-controlled integration commands.

Successful review runs DAG, manifests and contract integration on the actual
combined checkout, serially, with API tokens removed from child environments.
Only a passing gate emits the full manifest-derived area matrix. Every area job
checks out the same resolved group SHA and runs Node/browser consumers, one cell
at a time. Browser prerequisites and the final all-area gate are retained.
The context, gate outcomes and full consumer plan are saved as workflow artifacts.
No broader Project secret is added; missing Project access remains a failure.

The central `ci.yml` merge-group trigger and ordinary minimal core are unchanged.
This explicit lane is not automatically required by branch protection, and its
success is not implied by an ordinary core result. Hosted queue execution, live
Project access and platform/browser qualification remain unclaimed until run.
