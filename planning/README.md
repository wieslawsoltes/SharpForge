# SharpForge parity program and 0.15 delivery

The canonical [0.15 tracker #422](https://github.com/wieslawsoltes/SharpForge/issues/422) belongs to [Portfolio #1](https://github.com/wieslawsoltes/SharpForge/issues/1). This is planning/orchestration, **not a product implementation or a completed 0.15 release**.

The product baseline is `011f2bc3bdd84f8db82a928d117100017211ca78`, with the user's CI fixes at `7f0ca223d1b9a07725078260020019cfb276c241`. The original planning commit `631a698ff6e1d3553cf3e1e6c9b9d8823b894ba8` remains in this branch's ancestry even though its original branch was deleted.

## Reuse the live hierarchy

`catalog.txt` is the original 30-area inventory. `release15.json` selects **83 existing task issues**, four narrow new children, ten additional prerequisites and 31 parent-context items. These counts describe this scoped snapshot, **not the current repository's total issue count or independent leaf throughput**. The existing backlog is concurrently being decomposed into finer single-PR sub-issues.

Agents must inspect native sub-issues before claiming work. Claim a leaf, never both a parent and its child. Release labels on a selected parent include its child scope; they do not automatically imply that every future child has received a separate label. Existing board items and later tasks outside this manifest remain untouched.

| New slice | Existing parent | Separate responsibility |
|---|---|---|
| SF-R015-T01 / #423 | SF-A00-T11 / #14 | Source/provenance audit, not another product-recovery implementation |
| SF-R015-T02 / #424 | SF-A10-T08 / #151 | Cross-app numeric-worker and queued-memory fairness |
| SF-R015-T03 / #425 | SF-A26-T06 / #418 | JS runtime plus optional Wasm SIMD publishing, independently of the future Rust runtime |
| SF-R015-T04 / #426 | SF-A29-T12 / #408 | Actual Git/design/multi-app/downloaded-HTML release qualification |

0.15 explicitly covers the Designer toolbar alignment; per-C#-document Design/Split/Code; independent app instances; numeric/threading/Math/network performance; WinUI-compatible WebGPU drawing and fallbacks; app-only HTML publishing/downloads; remote Git with token or supported browser authentication; and realistic integration/security/release evidence. A WinUI Button content-alignment bug is separate from the IDE Designer-toolbar alignment task; preserve their different owners.

Rust remains part of full parity. The broader SF-A26-T06 keeps its Rust dependencies; its #425 child can deliver current JS/SIMD profiles without waiting for that future runtime. Closing a release slice never closes its broader parent automatically.

## Existing Projects, not duplicate boards

Portfolio #1 was updated during this follow-up and now lists **18 area boards plus Portfolio**. `project-bindings.json` records their actual owner project numbers (3 through 21) and maps the 30 workstreams onto them. The 32 logical selectors (portfolio, release, A00..A29) therefore target **19 existing boards**, not 32 new boards. `release` uses Portfolio #3; combined areas share their current board.

The reconciler **never creates or reopens a project**, changes its visibility, or overwrites its README. It validates the existing owner/number and stops on inaccessible or closed boards. `--bindings reviewed.json` explicitly overrides a mapping when an owner changes it; no title-based implicit adoption.

The existing boards and agent fields were provisioned separately. The repository issue workflow cannot establish project-field or membership updates: those require a separate project-authorized run and read-back. Custom views are recommendations, not programmatically created by this script.

From this branch, using Python 3.12+:

```sh
python scripts/planning/backlog.py
python scripts/planning/release15.py
python scripts/planning/projects.py --project all
python -m unittest discover -s scripts/planning -p 'test_*.py'
```

These commands are offline and make no GitHub mutations. Issue reconciliation uses repository-authorized `GH_TOKEN`:

```sh
python scripts/planning/release15.py --apply
```

It adds release labels, native parent/blocker links for the new slices, and stable scope comments. Existing bodies, statuses, assignments, parents and unrelated labels/dependencies are preserved. It rereads native relationships and labels and repeats the operation to verify idempotency. A matching marker is not an instruction to overwrite later human edits. Results are in the `release15-backlog-state` workflow artifact.

### Optional Projects reconciliation

Use an account authorized for the owner projects and repository; do not paste a token into chat, issues, commits, or command-line arguments:

```sh
gh auth login --scopes project
# Or refresh an existing login:
# gh auth refresh --scopes project

python scripts/planning/projects.py --project release --apply
python scripts/planning/projects.py --project A18 --apply
python scripts/planning/projects.py --project all --apply
```

The script uses `GH_PROJECT_TOKEN`, then `GH_TOKEN`, then the existing `gh auth token` result in memory. See [GitHub's Projects API authentication guide](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects).

The manual `parity-projects.yml` workflow can alternatively use an explicitly configured `SHARPFORGE_PROJECTS_TOKEN` Actions secret after it is available on the default branch. It has no push/PR trigger; this change did not create that secret or run a project-authorized mutation.

Apply has a 400-mutation default batch budget (`--max-writes 1..450`). Exit **2** means partial, not success; rerun the same command to resume. `planning/generated/projects-audit.json` records only actually read-back memberships/fields. An ambiguous write stops; rerun re-reads existing state. Existing issues are reused across boards, not copied into drafts.

The reconciler initializes five additive text metadata fields: `SF Work ID`, `SF Area`, `SF Release`, `SF Role`, `SF Dependencies`. It preserves existing native fields and all nonempty conflicting values rather than overwriting them. Agent, Branch, Lease expires, Lock keys and Evidence are created only if absent, and are never populated or reset. Existing Date/SingleSelect human fields remain unchanged. Status, assignees and unrelated/newly decomposed project items are untouched.

Suggested views: filter `SF Release=0.15` and group by `SF Area`; group agents with Status/Branch/lease/locks/evidence; inspect native blockers; use native child progress for parents. The original board's Workstream/Kind/Priority/Work ID fields are not replaced. Selected parent/child pairs are rollups, not independent completion credit.

## Parallel-agent rules

A00 owns shared ABI/registry/integration seams. A19 owns document/session services and shell CSS; A18 consumes those interfaces. A17 owns drawing, A10 numeric execution, A11 managed scheduling, A12 transports, A25 Git, A26 application export and A29 qualification. Shared dispatchers and registries require a coordinated integration change, not simultaneous area edits.

Before coding, inspect live children and claim one leaf with agent identity, branch, exact files/lock keys, heartbeat/expiry, dependencies and last verified commit. A project card is not an atomic lock; claim/lease enforcement remains separate implementation work. Readiness requires merged and qualified prerequisites. Handoffs include commands, environment, artifacts, failures and remaining work. Close only against reproducible merged evidence; no invented native/GPU/auth passes.

## Verification boundary

Unit tests use explicitly labeled fake clients for planner/reconciler behavior. Hosted issue provisioning separately verifies actual GitHub parents, blockers and labels. Native Projects reconciliation is not proved by either one. Product C#/CLR/WinUI parity, provider OAuth, downloaded apps, native SDK and physical-GPU qualification remain implementation acceptance work, not outcomes of creating a backlog.
