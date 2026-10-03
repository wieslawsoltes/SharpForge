# Contract gates, handoffs and verified rollups

Scope: A00 T10–T12, leaves #1098–#1112. These tools are offline Node/Git tooling;
they do not qualify CLR, browser, WinUI or a native runtime themselves. A29 owns
workflow/merge-group wiring and the capability inventory denominator.

## Contract integration

`node scripts/planning/contract-gate.js` returns one JSON summary for ID locks,
ABI version exports, generated schema fixtures and all area test manifests. It
also rejects duplicate numeric IDs even when the lock and registrar agree on the
same invalid merged tree. Tests create two real Git branches and combine their
individually valid contributions at a colliding ID.

`node scripts/planning/check-contract-change.js --base BASE --head HEAD --labels contract-change`
compares committed contracts. Non-additive changes require both the label and a
strictly larger relevant version; removing version components or reusing IDs fails.
Unknown schema changes conservatively require a declaration. Introducing the
initial registry is additive; subsequent incompatible contracts require the
baseline version registry and a strict bump.

`node scripts/planning/import-graph.js` regenerates the deterministic static ESM
graph. V8 parses actual declarations through its
[SourceTextModule API](https://nodejs.org/api/vm.html#class-vmsourcetextmodule);
the parser never links or evaluates input modules. All `.js` modules in packages,
apps and tests, and their repository-local static dependencies, are included.
Missing files/workspaces/exports fail. Dynamic imports are outside the static
graph; full browser qualification remains required for runtime-loaded modules.

`node scripts/planning/impacted-tests.js --base BASE` selects area manifests by
reverse transitive imports. Explicit paths can be supplied as positional args.
Package metadata and planning-tool changes select all manifests. Removed JS
modules select all when no previous graph is supplied to the API; callers may
provide both graphs for precise deletion selection. Documentation-only changes
select none. Selection supplements complete contract and integration gates.

## Evidence and replay

See [the runbook](../AGENTS.md) for executable claim, lock, heartbeat, evidence,
handoff, resume and release commands. Evidence bundles contain TAP, the selected
tool environment, and a manifest. The SHA-256 digest binds task, commit, command,
summary, file names and bytes. Absolute home paths in captured logs are redacted.
Handoff replay checks the published commit and reruns commands from a clean clone.
It reports result and environment differences instead of silently accepting them.

## Inventory denominator

`evidence.schema.json` is shared with A29 inventory/oracle consumers. The registry
`spec-revisions.json` uses append-only revision identities: C# 1–14, a dated C# 15
preview, ECMA-335 sixth edition, .NET reference pack 10.0.5 and Windows App SDK
1.8.260921001. These are pinned scopes, not claims about latest releases or parity.
Changing a preview or servicing version adds a new ID.

Inventory JSON has `{schemaVersion:1,rows:[...]}`; each row supplies `id`, `leafId`,
`area`, nonempty `platforms`, `engines`, and `specRevisions` arrays. Its Cartesian
product is the denominator. Multiple rows for one leaf count separate specified
capabilities; parent issues do not count as additional capabilities.

Evidence is an array of records with `schemaVersion`, `leafId`, `capabilityId`,
`platform`, `engine`, `specRevision`, `status`, `commit`, `evidenceDigest`. Status
is one of pass, fail, unknown, unsupported. There may be only one current record
per obligation. An artifact index maps each evidence digest to its downloaded
evidence directory; missing/changed artifacts or non-ancestor commits invalidate
evidence to unknown. An open or reopened leaf also invalidates coverage. Unsupported
is retained only with verified evidence and remains in the denominator.

```sh
node scripts/planning/rollup-publish.js --inventory inventory.json --evidence evidence.json --artifacts artifact-index.json --snapshot planning/backlog.snapshot.json --main origin/main
node scripts/planning/rollup-publish.js --inventory inventory.json --evidence evidence.json --artifacts artifact-index.json --publish
```

Publishing always regenerates byte-stable JSON/Markdown locally; `--publish` also
updates only changed numeric Parity percent fields per epic. All platform, engine
and revision obligations contribute to that percentage. Unknown and unsupported
have separate columns, and complete requires every obligation to pass. No live
parity report is fabricated before the A29 inventory and retained proof exist.

Validation commands after full implementation:

```sh
node --test tests/a00-10-contract-gates.test.js tests/a00-11-evidence.test.js tests/a00-12-rollup.test.js
node scripts/planning/import-graph.js
node scripts/planning/contract-gate.js
```
