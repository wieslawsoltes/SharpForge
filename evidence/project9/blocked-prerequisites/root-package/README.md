# Root package-lock prerequisite for the IO stack

The retained `project9-package-lock.patch` is **unapplied**. Its four additions reconcile the already-authored `@sharpforge/bcl-io` workspace with the root lock:

1. `packages["node_modules/@sharpforge/bcl-io"]` becomes the workspace link resolving to `packages/bcl-io`.
2. `packages["packages/bcl-io"]` records version 0.14.0, MIT license, Node >=22 and its `@sharpforge/bcl-core` 0.14.0 dependency.
3. `packages["packages/framework"].dependencies["@sharpforge/bcl-io"]` records 0.14.0.
4. `packages["packages/runtime"].dependencies["@sharpforge/bcl-io"]` records 0.14.0.

The patch changes only root `package-lock.json`. It has 1,368 bytes and SHA256 `8a5dbf77311a81382eef091968b06dfa77be0920385f8eb49dcd2ea6652b230b`. `package-lock.base.json` is the exact 10,877-byte pre-change root lock captured from the qualified local IO tree; SHA256 `0795c3e9cb2007594de2fa207c2a97d80bb927f146f68d8566934485cbddf0cd`. These bytes establish a reconstruction base, not permission to edit it.

## Authority and required integration

The `package-json` lock reserves both root `package.json` and `package-lock.json`. At 17:42:34 UTC its authoritative ref still points to [d538f55223dd3fcfcd234e170af8a166da81ad86](https://github.com/wieslawsoltes/SharpForge/blob/d538f55223dd3fcfcd234e170af8a166da81ad86/claim.json), owner `codex-p19-core`, issue #2072, generation `8f3f406a-3f3e-4ea7-ac65-258a5b41afe9`, recorded expiry 2026-10-04T20:04:09.592Z. The record's empty `locks` array and package-local paths do not remove the actual authoritative lock ref. Its Project-projection note does not create an alternate claim protocol.

The owner should review and integrate these entries on the oldest IO branch `codex/a09-string-reader` (#4509), or agree an explicit generation-aware handoff under the existing protocol. Reconcile against the actual then-current manifests and lock; preserve unrelated owner changes. Merge the resulting prerequisite through #4510, #4513, #4514, #4515, #4516, #4517 and #4542 in order. Then run a real clean install and the required checks on the exact updated heads. Keep every PR a draft until its actual merge requirements pass.

## Evidence and limits

`../io/io-clean-install-gate.log` records an actual failed clean install with EUSAGE and missing `@sharpforge/bcl-io@0.14.0` lock entries. Original published status records the core jobs' failed step `Run npm ci --ignore-scripts --no-audit --no-fund`. The 17:33:52 UTC refresh confirms `core: failure` on each exact published head, while deliberately not refreshing step logs. All eight are still drafts.

Local setup with `--package-lock=false` and the independently reviewed offline package smoke evidence do not establish clean source installation, hosted core success or merge readiness. This repair has not been applied or tested. The Boolean branch's identical base lock hash does not make it a suitable target for the IO workspace additions.
