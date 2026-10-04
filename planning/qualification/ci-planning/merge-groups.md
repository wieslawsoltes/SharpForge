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
claim lease and lock generation. The claim's issue number selects live Project
memberships through GitHub GraphQL; there is no default Project4 assumption or
hard-coded area-to-project map. Only unarchived claim projections owned by the
repository owner qualify. Issue repository/title and any Work ID must agree with
the claim, and exactly one managed Project item must remain. A populated Agent or
Branch marks a managed projection: both must match the authoritative claim, with a
nonempty Branch. Tracking-only boards with neither Agent nor Branch are ignored,
even when they carry a Work ID (as observed for issue483 on Project3 alongside its
managed Project4 item). Ambiguity, stale agents/branches, unavailable
membership data and incomplete pagination fail. The report retains the selected
Project and issue identity. This read-only lookup does not change claims or fields. The pinned base supplies ownership/hot-file
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
The trusted gate step receives the existing `PLANNING_PROJECT_READ_TOKEN` secret
as `PROJECT_READ_TOKEN` for read-only Project GraphQL queries. Repository reads
continue to use the read-only `github.token`; both transports reject mutations.
Missing either credential fails explicitly before transport. The Project token is
absent from resolver/install/area steps and stripped from candidate subprocesses.
This wiring does not create or configure the secret; missing access remains a failure.

The central `ci.yml` merge-group trigger and ordinary minimal core are unchanged.
This explicit lane is not automatically required by branch protection, and its
success is not implied by an ordinary core result. Hosted queue execution, live
Project access and platform/browser qualification remain unclaimed until run.

The membership query uses GitHub's documented [issue Project items](https://docs.github.com/en/graphql/reference/issues)
and [Project item field lookup](https://docs.github.com/en/graphql/reference/projects),
with at most ten pages of fifty memberships. The read credential must be able to
read the relevant repository issue and its owning Project; hidden or unavailable
Project metadata does not constitute a successful cross-project qualification.
