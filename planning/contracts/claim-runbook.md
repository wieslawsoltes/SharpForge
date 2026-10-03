# Claim command walkthrough

Prerequisites: Node 22+, authenticated `gh` with repo/project write permissions, project fields listed in claim-protocol.md, and existing labels agent:claimed, lease:expired, status:blocked. Test first without live mutations:

```sh
node scripts/planning/testing/walkthrough.js
node --test planning/contracts/tests/claim-race.test.js
```

For a real Ready leaf (replace the issue and unique session identity):

```sh
node scripts/planning/claim.js --issue 1080 --agent codex-session42 --branch codex/SF-A00-T07.3 --ttl-hours 24
node scripts/planning/lock.js --issue 1080 --agent codex-session42 --key studio
node scripts/planning/heartbeat.js --issue 1080 --agent codex-session42 --ttl-hours 24
node scripts/planning/audit.js --issue 1080
node scripts/planning/lock.js --issue 1080 --agent codex-session42 --key studio --release
node scripts/planning/release.js --issue 1080 --agent codex-session42 --handoff https://github.com/wieslawsoltes/SharpForge/issues/1080
```

All commands accept `--owner`, `--repo` and (except audit) `--project`. The branch argument is an implementation branch, separate from reserved `agent/`, `agent-ops/` and `agent-locks/` namespaces. The commands do not create or delete implementation branches.

```sh
node scripts/planning/reap-leases.js --owner wieslawsoltes --project 4
node scripts/planning/release.js --issue 1080 --agent codex-reconciler --reconcile --reason 'Previous agent stopped; handoff reviewed'
```

The reaper labels and reports but does not transfer ownership. Reconciliation is explicit and requires a reason. Never delete a mutex while its owner process might still run. Readiness, handoff reproduction and merged-evidence rollups are separate scopes; these commands never infer those results.
