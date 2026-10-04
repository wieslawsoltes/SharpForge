# A00 contract regeneration and focused validation

The source base is local merge `0e1ff8e8bde886b9ed583395adb466718b036511`, tree `a6bc77992bdb5f71a9209daf88cbd4461507ede2`, exactly equal to integration `59da6ca7710e867702189cd67e3eedd527fb8c13`. The base includes the reconciliation with main that produced the actual core CI merge tree, the reviewed inventory descriptions, and the caught/uncaught nested-fault fixture repair. Regenerated artifacts were working-tree changes during validation; their before/after hashes are explicit in [journal.json](journal.json).

| Run | Result | Scope |
| --- | --- | --- |
| Value inventory | exit 0 | Recomputed fingerprints and the reviewed current-JS descriptions; Portable Value ABI 1 unchanged. |
| Root-site manifest | exit 0 | Re-extracted 14 reviewed literal definitions/calls. The guard is unchanged. |
| Schema generation | exit 0 | Generated all eleven outputs into a staging directory; copied only four reviewed changed outputs. |
| Five-file focused A00 | **81/81 pass**, no failures/skips | Value inventory, execution/safepoints, nested faults, metadata and typed IR; Node duration 13,577.443668 ms. |
| Old/new image compatibility | **2/2 pass**, no failures/skips | Exact catch boundaries, old alias/inferred metadata, schema/load/verification and actual source-VM output; Node duration 1,122.271563 ms. |
| Full selected 28-file A00 attempt | **Incomplete** | Stalled in the ninth file, the registration harness, on a nested run-slot acquisition; interrupted with tool session exit 130. No aggregate test summary or full-area pass is claimed. |

These results overlap and must not be summed. The incomplete full attempt does not include the subsequently authored two-case compatibility file in its explicit argument list. Root assigned the resource-lock repair separately; registration was not omitted or bypassed to obtain a green full-area result.

All commands used `scripts/limited.js`, `SHARPFORGE_MAX_PARALLEL_RUNS=1`, `SHARPFORGE_TEST_CONCURRENCY=1`, `SHARPFORGE_MAX_OLD_SPACE_MB=512` and `NODE_OPTIONS=--max-old-space-size=512`. The exact expanded argv, source revision/tree, Node version, timings, output hashes and generation before/after hashes are in the journal. The compatibility wrapper's 187.5-second elapsed duration includes waiting for the resource slot and is not its test duration.

[schema-diff.json](schema-diff.json) lists every changed schema JSON field. [semantic-proof.json](semantic-proof.json) records all 22 changed MemberRef call sites with complete old/new descriptors and asserts that normalizing only those IDs leaves all other body fields equal. The remaining three fields are canonical exception identity and an explicit catch-end coordinate in the nested-finally image. The [contract review](../../../../planning/contracts/a05-runtime-contract-review.md) explains the source change and unchanged ABI/schema contracts. All other generated schema outputs remain byte-identical.

The full attempt retained the outer one-slot wrapper while a synchronous registration fixture spawned a nested `run-tests.js` waiting for that same slot. Its raw incomplete log is preserved. After interruption, a stale lock containing namespace PID `5` also prevented new wrappers from reclaiming the slot. Root independently confirmed both known wrappers had no active test children and authorized deletion of that exact unchanged abandoned file only. Its bytes/hash and rationale are retained; inode/mtime values initially recorded before deletion were overwritten by the pending compatibility wrapper's stale journal rewrite, so the final journal explicitly marks those exact stat values unavailable. The active compiler batch was not killed, and the resource limit was not increased.

The archived runner and staging-generator source are retained byte-for-byte as `.txt` files to keep evidence separate from executable repository tools. [manifest.json](manifest.json) supplies sizes and SHA-256 hashes for all eleven retained originals. Empty inventory/root logs are successful commands with explicit exit codes, not omitted evidence.
