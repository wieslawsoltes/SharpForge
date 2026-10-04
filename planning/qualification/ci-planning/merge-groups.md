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
combined-tree qualification. The separate gate/workflow integration consumes this
context while retaining the existing manual, serial qualification policy.

Regressions use temporary real Git repositories and fake read-only GitHub
responses. They do not establish live GitHub queue topology or token access.
