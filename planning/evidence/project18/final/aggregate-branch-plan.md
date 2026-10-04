# Aggregate integration branch protocol and completed result

The coordinator released this protocol at the frozen canonical source.
The resulting branch is `codex/p18-final-integration` at `69122b13e8ac9a02459ab1f9bc0108a25296518e`,
with exact tree `55e5f5c443d15030bc47592e6ba511862812f363` and all 34 reviewed parents.
The [commit/ref receipt](aggregate.json) and [tree transport receipts](aggregate-transport.json)
retain the completed proof. It does not create a large product
pull request or merge anything into main. The individual feature PRs remain the
review units. The separate documentation/evidence draft retains the complete
report, raw archive and original-source bundle.

## Source and ancestry are separate identities

The aggregate commit must have the exact frozen canonical Git tree. Its ordered
parents must be actual published commits: the maximal feature heads in the final
deduplicated owner index. The aggregate therefore records a reviewed resolution
of those branches. It is not a copy of the final tree attached to invented
ancestry. The GitData aggregate commit will have its own identity; qualification
remains tied to the original canonical source commit and identical tree.

The incremental bundle preserves original canonical commit identities and
history outside the pinned-main prerequisite. It is still required even when
the aggregate branch makes the complete code tree directly retrievable from Git.

## Final actual-parent assessment

The final sealed owner census contains 159 distinct feature PR heads. Its
SHA-256 is `b026bdf4f6bac3916a077149521965640e2ebf92577843de7dafe580e048b032`.
The exact parent audit resolves them to 34 maximal actual published parents,
with no unresolved ancestry or tree/parent mismatches. Pinned main
`1db2e1d540a78403b7aaddcf472311fcde1a81ef` is already reachable and needs no
redundant parent. Source and tests are frozen at `0bb2ed36`; final canonical evidence metadata is frozen at `c68c7725`, and root has
released exact-tree aggregate publication.

The audit uses retained actual Git objects and exact GitData commit GET
responses. Local projection identities never substitute for actual remote
commits. The surrounding census metadata was sealed after the row audit;
all 159 number/head/tree/ordered-parent identities remained identical.
The complete proof is archive member
`assessment/publication-plan/aggregate-final-159-parent-proof.json` in the
[qualification archive](artifacts/README.md).

The 151 published-only paths have complete lineage classifications. No product
implementation is missing. Eighteen unique qualification cases in eight files
were retained and passed within the 43-test scope at `886fb139`. Extracted
duplicates, replaced facades and obsolete upstream fixtures remain explicitly
classified. Title similarity alone was not used as assertion proof.

The earlier e9 assessment of 154 heads and 33 maximal parents remains historical.
It does not supply the final parent list. Tree-labelled source references were
normalized through `commit^{tree}`; raw correction history is archive member
`assessment/publication-plan/aggregate-tree-label-corrections.json`.

## Concrete tool contract

The installed GitHub connector exposes:

| Operation | Relevant arguments |
| --- | --- |
| `github_create_blob` | `repository_full_name`, `content`, `encoding` (`utf-8` or `base64`). |
| `github_create_tree` | `repository_full_name`, `base_tree_sha`, `tree_elements`. |
| `github_create_commit` | `repository_full_name`, `tree_sha`, `parent_sha`, ordered `additional_parent_shas`. |
| `github_create_branch` | `repository_full_name`, `branch_name`, exactly one existing `sha` or `base_ref`. |
| `github_update_ref` | `repository_full_name`, `branch_name`, `sha`, `force: false`. |
| `github_fetch` | Approved exact GitData/ref/PR GET URLs for immutable readback. |

The tool schema declares no maximum parent count or request-byte size. That is
not a promise of unlimited server or transport capacity. GitHub's official
[commit API](https://docs.github.com/en/rest/git/commits?apiVersion=2022-11-28#create-a-commit)
describes a parent array and multiple-parent merge commits without a documented
count limit. The [tree API](https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28#create-a-tree)
accepts a base tree and entries by path, mode, type and SHA; a null SHA deletes an
entry. Its recursive-GET response limit is a readback consideration, not an
advertised create-request capacity.

At the provisional source, 1,295 changed paths produced a 179,428-byte JSON tree
entry list. That historical 33-parent list required only 1,452 JSON bytes. Of those paths,
890 already had a conservative remote object proof. The remaining 405 paths
contained 401 distinct blobs totalling 5,449,451 bytes; 279 paths were tracked
evidence. Unproven does not mean absent. Updated feature receipts and existing
remote trees can establish further reuse before creating any blob.

A real documentation correction already transferred 94,254-byte and 37,653-byte
UTF-8 blobs in this session by reading bounded 16,000-character chunks and
creating each complete Git blob. This demonstrates that route for those sizes;
it does not establish a maximum binary bundle payload. Binary archive upload
remains covered by the separate bounded-part fallback in [the artifact staging contract](artifact-staging.json).

## Publication sequence after release

1. Seal the canonical commit/tree, final owner PR index, exact check receipts,
   missing-path classifications and additional test-scope result. Record hashes
   of these inputs and the final workflow files.
2. Resolve every named published head through its actual commit/tree receipt.
   Read only missing exact commit metadata, without refreshing main. Traverse
   ordered parent edges, remove duplicate and ancestor heads, and retain a
   deterministic maximal-parent list. Include pinned main only if no selected
   parent already contains it.
3. Choose one real primary parent for the aggregate and record why. A stable
   option is the head covering the most other recorded features, with PR number
   and SHA as tie breakers. Preserve the remaining stable order in
   `additional_parent_shas`; do not claim that order is chronological execution.
4. Diff the frozen canonical tree against pinned main. Preserve exact path,
   mode, type and Git object identity. Reuse objects proven present in actual
   remote trees. Create only missing or still-unproven reviewed content, verifying
   each returned blob SHA against the local object identity. If a request fails
   for size, split the transport workload; do not change the desired tree.
5. Call `github_create_tree` with the pinned base tree and exact changed entries.
   The returned root tree SHA must equal the frozen canonical tree before any
   commit or branch is created. Verify unchanged protected files and workflow
   identities as part of that exact-tree condition.
6. Create one commit with that tree and the reviewed actual parent list. Read
   it back, checking tree and complete ordered parents. Create the proposed
   `codex/p18-final-integration` branch at that commit. If the ref already exists,
   inspect it and preserve history; never force it or overwrite an unrelated ref.
7. Read back the branch and commit again. Record the aggregate commit, canonical
   source/tree, actual parents, input-manifest hashes and branch URL. The report
   must distinguish code-tree equivalence from a new test run on the aggregate
   commit. No large product PR is opened for this branch.

If the actual service rejects the multi-parent commit, the fallback is a set of
real two-parent integration joins. Each intermediate tree must represent only
the branches actually joined at that point and preserve reviewed conflict
resolutions. Reusing the entire final tree at each early join would misrepresent
ancestry and is not an acceptable workaround. The coordinator must review the
fallback before it is performed.

## Workflow and resource behavior

At the reviewed candidate all 25 workflow files are identical to pinned main.
CI and Pages push triggers select only `main`; release selects version tags.
The Project16 create-event workflow requires the branch prefix
`codex/project16/qualify-` for its job. The proposed Project18 aggregate branch
does not match. A skipped create-event workflow record may still appear.
The exact workflow review is archive member
`assessment/publication-plan/aggregate-workflow-review.json` in the
[qualification archive](artifacts/README.md).

This plan adds no `full-ci` label, manual dispatch, release, version tag, merge
group or deployment. The separate evidence draft receives the ordinary required
check. Root-owned qualification remains serial; no bundle packing or compression
starts until the coordinator releases the heavy-work slot.

## Release conditions

Product/test source, the final parent index, omission resolution and raw evidence
are sealed. The exact canonical tree `55e5f5c443d15030bc47592e6ba511862812f363`
is frozen. The aggregate commit/ref and root-verified bundle/archive have been created.
All 17 stored binary blobs have uploaded with matching Git identities; exact-ref
binary byte readback and the evidence draft remain separate recorded steps. Prepared and published small feature-maintenance corrections are
recorded separately and are not counted as aggregate publication.
