# Planning agent runbook

Use Node 22 or newer, Git, and authenticated `gh`. Work in an isolated worktree.
The Project item owns the task identity, branch and lease; implementation branches
are separate from reserved claim, operation-mutex and lock refs. Never take over a
live or expired lease implicitly. Follow the ownership map and hold the specific
hot-file lock before changing a shared file.

Run the complete offline claim-to-release walkthrough, including a real bare Git
remote, HTTP fake GitHub, published WIP handoff and clean-clone replay:

```sh
node --test planning/contracts/tests/evidence.test.js
node scripts/planning/testing/walkthrough.js
```

For live work, replace the example issue, agent and task with a Ready leaf. A task
is Ready only when its prerequisite contracts have merged and are qualified.

```sh
git worktree add ../SharpForge-task -b codex/SF-A00-T11.2 origin/main
cd ../SharpForge-task
npm ci
node scripts/planning/claim.js --issue 1104 --agent codex-session42 --branch codex/SF-A00-T11.2 --ttl-hours 24
node scripts/planning/lock.js --issue 1104 --agent codex-session42 --key studio
node scripts/planning/heartbeat.js --issue 1104 --agent codex-session42 --ttl-hours 24
```

Only request locks actually needed by the task. Implement the whole scope before
running its validation batch. Inspect other agents' branches before integration;
do not reset or edit their working trees. Preserve the existing stack by rebasing
only clean, idle branches, and validate the resulting complete integration.

```sh
node scripts/planning/check-ownership.js --area A00 --base origin/main --locks studio
node scripts/planning/contract-gate.js
git add scripts/planning planning/contracts tests
git commit -m 'Implement task handoff writer'
node scripts/planning/capture-evidence.js --task SF-A00-T11.2
git push -u origin HEAD
```

Evidence must be captured at the final committed revision before handing off;
capture again if the commit changed. Upload the complete
`artifacts/evidence/SF-A00-T11.2/` directory as a CI artifact. Handoff details JSON
contains `commands` (each with `argv` and expected `summary`), aggregate `testSummary`,
`blockers`, `remainingSteps`, `openQuestions`, and optional `evidenceDigests`.
Each summary has `tests`, `passed`, `failed`, `cancelled`, `skipped`, `todo`,
`exitCode`, and `complete` (complete TAP statistics). A command without TAP remains
useful handoff context but cannot qualify parity. Captures are retained in digest
subdirectories, not overwritten by subsequent commands.
Use portable argv arrays and repository-relative paths; no shell interpolation.
The writer collects branch, exact commit and environment itself, reruns each
command, attaches its tested commit, target proofs and digest, and refuses an unpublished head.
`--wip` explicitly stages all changes, commits, recaptures commands at that commit,
and pushes before posting; inspect the worktree first. A handoff is not a passing parity claim.

```sh
node scripts/planning/handoff.js --task SF-A00-T11.2 --issue 1104 --agent codex-session42 --details /tmp/handoff-details.json
node scripts/planning/handoff.js --task SF-A00-T11.2 --issue 1104 --agent codex-session42 --details /tmp/handoff-details.json --wip
node scripts/planning/resume.js --issue 1104
```

Resume requires a clean checkout, fetches the recorded implementation branch,
checks that it contains the exact commit, checks out that commit detached and runs
the recorded argv commands. Only resume a reviewed handoff from a trusted agent:
the commands are executable repository work. Environment and result divergences
are reported, including unavailable Chromium or .NET; these are not native passes.

PRs identify the leaf using `Task: SF-A00-T11.2`, use the preceding stack branch as
base, describe final behavior and validation, and link retained evidence. For an
incompatible contract change, apply `contract-change` and bump the relevant
`versions.json` component. An additive append must retain existing IDs and shapes.

```sh
node scripts/planning/lock.js --issue 1104 --agent codex-session42 --key studio --release
node scripts/planning/release.js --issue 1104 --agent codex-session42 --handoff https://github.com/wieslawsoltes/SharpForge/issues/1104
```

The reaper only marks expired claims. Explicit reconciliation needs a reason and
confirmation that the previous process has stopped; it does not delete product
branches. See [claim-protocol.md](contracts/claim-protocol.md) for recovery.

Parity evidence needs a command-emitted `sharpforge-evidence` TAP comment naming
its capability, actual platform/engine, registered specification revision,
status, and unique TAP test name. Unknown/unsupported targets include a reason.
See `contracts/a00-gates-evidence.md` for the exact proof format. A generic passing
suite or a skipped availability probe never implies parity for another target.
