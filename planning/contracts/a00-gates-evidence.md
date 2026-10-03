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

The existing `core` PR job invokes `node scripts/planning/review-gates.js` before
dependency installation and validation. It reads labels only from GitHub's PR
event snapshot, verifies the workflow checkout SHA and its PR head/merge parents,
and compares committed contracts from the pinned base/head's unique merge base
to the PR head. This excludes unrelated changes made on the base branch after
the PR branched. Missing or mismatched event context fails closed. The same step
rejects a `seam` PR that changes the golden lock, without rebuilding the corpus.
Adding or removing a label reruns `core`. Pushes, manual qualification and merge
groups do not carry a PR label snapshot and do not run these review-only gates.

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
handoff, resume and release commands. Evidence capture refuses a dirty checkout, pins HEAD before the command, and
requires the same clean HEAD afterward. A command that modifies tracked/untracked
source or commits a new HEAD cannot produce qualified evidence. Generated ignored
artifacts remain allowed. The SHA-256 digest binds the bundle protocol version,
task, commit, portable command, summary, exact target obligations, file names and
bytes. Immutable digest subdirectories retain multiple runs under
`artifacts/evidence/<task>/<digest>/`; upload the entire task directory. Stdout TAP
and stderr are stored separately, so stderr cannot fabricate test results. Home
paths in both logs are redacted.

A passing area suite alone makes no parity claims. Qualification producers emit a
structured TAP comment from the actual command that exercised the target:

```text
# sharpforge-evidence: {"capabilityId":"feature.one","platform":"linux","engine":"source","specRevision":"csharp-14","status":"pass","testName":"source feature.one"}
```

The named TAP result must occur exactly once. A pass requires complete TAP
statistics, a successful command, and an actual passing result without SKIP or
TODO. Failure proofs reference a failing test; unknown/unsupported proofs require
an explicit reason and can reference the corresponding availability probe. A
producer must observe the real target it claims; this protocol binds that claim
to retained executed output and does not turn a simulator into native evidence.
`evidence-proof.schema.json` specifies these comments; version 2 bundles use
`evidence-bundle.schema.json`. Old generic bundles cannot qualify target records.
Changing capability, platform, engine, revision, status, or reason on a rollup
record invalidates an artifact that did not explicitly prove that same obligation.

Handoff commands are always rerun at the final committed HEAD. In particular,
`--wip` commits first, recaptures each command, then pushes before posting. Each
command records its tested commit, exact target proofs and evidence digest; prior passing summaries
are never attributed to new WIP code. Failing WIP commands remain failures in the
handoff. Replay checks the published commit, reruns commands, and reports result,
environment, target proof, HEAD, or working-tree differences; it stops after source mutation.

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
is one of pass, fail, unknown, unsupported. Unknown and unsupported records require a reason. There may be only one current
record per obligation. An artifact index maps each evidence digest to its downloaded
digest subdirectory; missing/changed artifacts or non-ancestor commits invalidate
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

The inherited build/ABI integration was also validated by the root agent with
2,764/2,764 Node tests on Node 24.21.0 and the Python environment. This is separate
from the earlier T06 evidence that truthfully recorded two pending ABI fixes.

Evidence hardening validation on macOS arm64 / Node 24.21.0:

- Complete manifest-driven `npm test`: **2,812/2,812 pass**.
- Focused evidence/rollup tests: **16/16 pass**; real Git repositories, a bare
  remote, an HTTP fake project server, and a fresh clone are exercised.
- `npm run check`: **382 modules, zero syntax errors**; all 30 manifests cover
  82 Node files and 16 Python suites without missing or duplicate ownership.
- `contract-gate.js`: all four checks pass (IDs, versions, schema fixtures,
  manifest ownership). The claim-to-release walkthrough reports no audit gaps.

Regression cases include dirty passing edits over a failing committed file,
tracked/untracked mutations and commits during execution, target/status/reason
reuse, changed artifact metadata and TAP bytes, absent/ambiguous/skipped/TODO
proofs, incomplete/contradictory TAP statistics, stderr spoofing, retained failed
and unavailable targets, stale WIP summaries, replay target changes, and replay
source mutation. Windows/Linux execution of this hardening remains a CI
qualification target; local Node fixtures are not native-runtime parity claims.
