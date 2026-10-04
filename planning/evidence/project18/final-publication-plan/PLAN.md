# Project18 final evidence publication plan

This is a staging plan, not a published result or a completed acceptance claim.
The final source, qualification outputs, coverage index and publication receipts
must be frozen together before creating the evidence draft.

## Publication shape

Create one documentation/evidence draft in `wieslawsoltes/SharpForge`, with the
actual pinned main commit `1db2e1d540a78403b7aaddcf472311fcde1a81ef` as its
parent. Do not refresh main for this publication. The draft adds only files under
`planning/evidence/project18/final/`; it does not modify product source, workflow
configuration, structure allowances, the protected Studio entry or root manifests.

The readable part contains the final coverage map, a deduplicated PR index, source
and artifact identities, qualification outcomes, remaining acceptance clauses,
and restoration instructions. The binary part contains an incremental Git bundle
and a compressed archive of raw evidence. Keep these two artifacts separate:
the bundle already contains a compressed Git pack.

The Git bundle preserves original source commit objects and parent order. The
outer evidence commit may be created through GitData, but no source commit is
rewritten through that API. Qualification is tied to original source and tree
identities, rather than the outer evidence commit's identity.

## Required readable records

| Record | Required content |
| --- | --- |
| `README.md` | Source identity, scope, status, prerequisites and exact restore commands. |
| `coverage.json` | Every Project18 issue/leaf, implementation paths, precise evidence and remaining clauses. |
| `pull-requests.json` | Unique PR identity, actual base/head, source projection, tree, ordered parents and required-check receipts. |
| `source.json` | Pinned prerequisite, final canonical commit/tree, advertised bundle refs and all included source heads. |
| `artifacts.json` | Original byte counts, SHA-256, Git blob SHA, compression/part format and reconstruction order. |
| `qualification.json` | Commands, tool versions, source/tree, status, counts, exit codes and raw archive paths. |
| `protected/review.json` | Unapplied patch status, exact protected base hashes, patch hashes, review and lease observations. |
| `protected/*.patch` | Final reviewed Studio and root lockfile patches as text artifacts. |

The current coverage/index snapshots are historical inputs. Their 132-PR count
predates subsequent publications and maintenance; it must not be reused as a
final count. Count each feature PR once, and keep merge-only dependency branches
and forward maintenance in their associated records.

GitHub's asynchronous `mergeable: null` state is unknown, not a conflict. Preserve
raw observations with time and head identity. Report a concrete conflict only
when supported by an actual merge result or a settled matching-head observation.

## Required raw archive contents

Use an explicit frozen file manifest, not a recursive copy of the workspace.
The archive must preserve historical failures as well as successful corrections:

- Tracked Project18 evidence from the final canonical source tree, including
  original runtime, compiler, native, filesystem, template and workspace records.
- Final root qualification logs and receipts, including initial consolidated
  failures, each affected replay, both Node cohorts, core/build/checkout output,
  strict structure output and static comparison against actual pinned main.
- Native SDK/tool identities, package-free reference results and the single
  bounded NuGet attempt's raw output and exit status.
- Browser launch and diagnostic output, with actual failure/success status and
  resource observations. Node mocks do not stand in for browser acceptance.
- Historical and final benchmark samples, median/p95 summaries, command receipts,
  stderr and CPU profiles. Preserve unresolved budget/sign-off obligations.
- Final owner publication maps and exact tree/ref/parent/check receipts, retaining
  superseded failures and their corresponding forward fixes.
- Protected patch text and review receipts; generated executable candidate copies
  such as `p18-studio-proposed.js` are excluded.

Each archived file receives a normalized relative path and a SHA-256 recorded in
the archive manifest. Original log bytes remain unchanged. Reject symlinks,
absolute archive paths and `..` traversal. Exclude dependency caches, build
outputs, working copies, credentials and unrelated user files.

## Source history bundle

The primary bundle advertises the frozen canonical integration ref and excludes
ancestors of the pinned main prerequisite. At planning time the integration ref
is `refs/heads/codex/p18-integration`; verify it still resolves to the agreed final
source immediately before packing.

The root owns the bundle step after releasing the heavy qualification slot. Use
bounded packing (`pack.threads=1`, a 64 MiB window-memory limit and a 32 MiB delta
cache). Do not create a full independent repository bundle containing all main
history. Verify the bundle in a repository containing the pinned prerequisite.

Inventory source commits referenced by the final coverage map. Each must be
reachable from the bundle's advertised heads or the prerequisite; otherwise add
an explicit source ref to the bundle or identify the external published history.
Do not imply that local projection commit identities are included merely because
an equivalent remote tree is published. Record remote/tree equivalence separately.

## Size and upload route

The read-only estimate at source `bb2b8d84` found 5,432 objects outside pinned main:
28,750,651 uncompressed bytes and 12,493,627 bytes in existing Git object storage.
It also found 4,592,657 bytes of tracked evidence. These are planning measurements,
not a measured final bundle or archive size. Later logs and source corrections
must be inventoried at the final source before packing.

The authorized GitHub tooling exposes `github_create_blob` with base64 content,
then `github_create_tree`, `github_create_commit`, branch creation/ref updates and
draft PR creation. No release-asset or workflow-artifact upload operation is
exposed. Use the repository blob path; do not inspect credentials or use an
unapproved external upload service.

Prefer complete binary files when supported by the actual tool payload. If a
payload limit requires splitting, use deterministic 4 MiB binary parts, except
the final shorter part. A 4 MiB part produces 5,592,408 base64 characters. The
tool schema advertises no payload size bound, so final feasibility remains an
observed upload result, not an assumption.

Local data can be read through bounded shell-output chunks and assembled inside
the orchestration runtime without printing base64 into chat. A 48 KiB raw chunk
is divisible by three and yields 64 KiB of base64; check every returned length
and reject truncation before joining chunks. Use small sequential or bounded
parallel reads. The manifest records whole-file and per-part hashes, preserving
the exact bundle bytes when parts are concatenated in order.

## Final sequence

1. Receive the root's final source freeze, final qualification outcomes and
   refreshed coverage/publication maps. Freeze exact input paths and hashes.
2. After the root releases packing, create the bounded incremental bundle and
   deterministic raw archive. Sort archive entries and fix uid/gid, mode and
   timestamps; use gzip with a fixed timestamp. Retain all original payload bytes.
3. Verify bundle prerequisites, advertised refs, final source tree and archive
   file hashes. Verify any split-file reconstruction before uploading.
4. Upload immutable blobs. Compare each returned Git blob SHA with the locally
   calculated blob identity. Reuse successful immutable uploads if a later call
   fails; do not create extra draft commits to retry content transfer.
5. Create one tree and evidence commit with the pinned parent. Publish the
   requested draft only after the complete result is concrete and reviewable.
6. Read back the tree, branch head, parent, PR base/head/draft state and required
   check. Record the exact publication receipt outside the artifact it describes.

No packing, archive compression, upload, publication or new qualification was
performed to prepare this plan. Final product acceptance remains governed by the
named fixtures and explicit gaps, including protected integration, native test
framework packages, platform/browser coverage and measured performance budgets.
