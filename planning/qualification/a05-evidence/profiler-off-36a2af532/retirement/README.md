# Historical reference36 checkout retirement

Only the reproducible profiler reference checkout was retired on 2026-10-04.
The measured product36 checkout, protected reference branch, original observations,
original generator manifest/patch, and all original before/after verification records remain retained.
No tests, builds, profiling, or measurements were performed during retirement.

## Exact retained identities

| Object | Identity |
| --- | --- |
| Source commit | `36a2af53287a563fd47d3a33b8e6e6382a726d35` |
| Source full tree | `da3add4a11cce5ed887d2a093eac4b48a4c26754` |
| Reference commit | `6f26b84f46053b4aafd3ab8e77150cc793790d8d` |
| Reference full tree | `0f987d136a2eca1c7302d3e5059cf5a0f9faa0c1` |
| Protected branch | `codex/a05-profiler-reference-historical-36` |
| Original evidence archive commit | `eb436f98aa20876b16b3d28ca96e9b1240ee7c87` |

The original archive contains `docs/a05-evidence/profiler-off-36a2af532/profiler-reference.json`
and `docs/a05-evidence/profiler-off-36a2af532/profiler-reference.patch`.
Those Git blobs were compared byte-for-byte with the external original files before removal.
Their SHA256 digests are retained in `retirement.json`.
The original manifest retains all sparse patterns, changed source hashes, dependency provenance, and the complete patch.
The raw 270-byte Git commit object body is retained here as `profiler-reference.commit`.
Its Git object hash and first tree line were independently checked against the protected reference commit/tree.

## Removal proof

The reference index/worktree was clean. All 4,620 materialized tracked blobs and modes matched Git;
the inventory digest also matched the original post-measurement inventory.
The full patch, all 15 changed-file before/after hashes, transform digest, and dependency links matched the original manifest.
The only ignored dependency entry was `node_modules/@sharpforge`, linking to the unchanged immutable product36 scope.
No unique ignored or untracked artifacts were removed.

`git worktree remove` completed with exit 0 without `--force`.
The journal records the exact command, before/after free space, and surviving branch/product checks.
The checkout occupied 40,091,648 allocated bytes (38.23 MiB).
Available filesystem space increased by 42,401,792 bytes (40.44 MiB);
that observed global delta can include unrelated concurrent filesystem changes.

## Reconstruction procedure

This is a documented procedure, not an executed reconstruction or a new qualification result.
The full Git tree remains reachable through the protected reference branch.
Create a detached worktree at the exact reference commit with `--no-checkout`,
restore the original manifest's non-cone sparse patterns, then materialize with `git read-tree -mu` at that commit.
Recreate its real `node_modules` directory with the recorded entry links using
`bench/vm/profiler-reference-dependencies.js` from the immutable product36 checkout.
Import the reference through its explicit `packages/runtime/src/index.js` entry point.
Run the original strict verifier and all materialized-blob checks before any future use.

If reconstructing from retained source and patch instead, materialize the exact source commit,
apply the retained patch with `git apply --index`, and verify `git write-tree` equals the reference tree above.
`git hash-object -t commit -w profiler-reference.commit` must return the exact reference commit above.
The raw commit body preserves the original parent, tree, author, committer, timestamps, and message;
creating a new commit would produce a different historical identity.

The historical manifest records historical absolute paths and must remain unchanged.
A future measurement at different paths must record and verify fresh path/dependency provenance;
it must not relabel this historical evidence or its inconclusive six-row result as a new run.
