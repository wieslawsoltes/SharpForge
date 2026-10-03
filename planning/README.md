# SharpForge parity program and 0.15 delivery

The canonical release tracker is [#422](https://github.com/wieslawsoltes/SharpForge/issues/422), under the [full-parity portfolio #1](https://github.com/wieslawsoltes/SharpForge/issues/1).

This is planning and orchestration code, **not a product implementation or a 0.15 release**. The product baseline is `011f2bc3bdd84f8db82a928d117100017211ca78`; the independently authored CI fixes in `7f0ca223d1b9a07725078260020019cfb276c241` are preserved. The original planning commit is `631a698ff6e1d3553cf3e1e6c9b9d8823b894ba8`. Its former branch may be deleted; the current planning history retains that immutable commit.

## One backlog, not duplicate implementation projects

`catalog.txt` defines 30 areas, 60 epics and 360 tasks, with stable IDs, audited source paths, proposed write boundaries, concrete acceptance tests and dependency gates. `release15.json` selects **83 existing tasks**, adds **four narrow child tasks**, and computes **10 additional prerequisites and 31 parent-context items**. The four new children are:

| ID | Parent | Separate deliverable |
|---|---|---|
| SF-R015-T01 | SF-A00-T11 | Source/provenance reconciliation, not another recovery implementation |
| SF-R015-T02 | SF-A10-T08 | Cross-app numeric-worker and queued-memory admission/fairness |
| SF-R015-T03 | SF-A26-T06 | Existing JS runtime plus optional Wasm SIMD HTML publishing, independently of the future Rust runtime |
| SF-R015-T04 | SF-A29-T12 | Real Git/design/multiple-app/downloaded-app acceptance and release evidence |

The release tracks 87 deliverables, not 128 independent implementations. The 128 work items also include prerequisites and parent context. Together with the tracker, the release board has 129 intended memberships. The full portfolio has 426 intended memberships: the original 421 issues, the release tracker and four child tasks. Read the hosted provisioning artifact for actual issue numbers and remote verification results; counts in configuration are not evidence that writes succeeded.

The 0.15 scope explicitly includes:

- Designer icon/text alignment and per-document Design/Split/Code using the original C# editor; imported, new, renamed and partial compatible files are covered.
- Multiple project apps and multiple instances, isolated heaps/workers/output/debugging/permissions/windows, and explicit live-designer session attachments.
- Worker fairness and throughput, SIMD and numerics, BCL Math, networking lifecycle/security and managed WebSocket expansion.
- WinUI/Composition-compatible drawing, separately identified optional Win2D APIs, actual WebGPU execution and operation/device-loss fallbacks.
- Runtime-only HTML publishing for supported console, explicit library-entry and WinUI projects, dependency closure, offline assets, actual downloads and secret exclusion.
- Provider-neutral remote Git, public/private access, token and supported browser auth, status/stage/commit/push, dirty-buffer and conflict protection.
- Actual deployed/downloaded app, auth, network, GPU and archive qualification, with unsupported environments recorded honestly.

“Any project/repository” is evaluated against explicit API, platform, transport and provider capabilities. Never replace an unsupported operation with a simulated success.

## Issue provisioning

Run from the repository root, using Python 3.12+:

```sh
python scripts/planning/backlog.py
python scripts/planning/release15.py
python -m unittest discover -s scripts/planning -p 'test_*.py'
```

These commands are offline and do not modify GitHub. To provision with a repository-authorized credential supplied securely as `GH_TOKEN`:

```sh
python scripts/planning/seed.py --apply
python scripts/planning/release15.py --apply
```

The repository workflow runs the release overlay and then repeats it to check idempotency. It adds release labels, native parent/blocker links for the narrow slices, and deduplicated scope comments on the existing epics, tracker and portfolio. It does not rewrite existing bodies, close issues, reassign agents, or remove prior labels/dependencies. Existing parent mismatches and ambiguous IDs stop before changes. A failed or ambiguous write is resumed by rediscovering stable markers, not guessing the next issue number.

`planning/generated/release15-state.json` contains resolved IDs and roles. `release15-result.json` is the remote read-back summary. These are published by the workflow as `release15-backlog-state`. Successful provisioning is not implementation evidence.

## Native GitHub Projects: separate authorization

**Native Projects boards are not created by the repository issue token.** `projects.py` supplies an independently authorized, resumable provisioning path. It defines **32 boards**: 30 area projects, one full-parity portfolio and one 0.15 delivery project. It adds the same issue node to multiple boards; it does not create draft copies or reparent tasks to the release tracker.

Use an account authorized for the repository and the owner's Projects. GitHub CLI authentication can obtain the required scope without putting credentials in an issue or chat:

```sh
gh auth login --scopes project
# For an existing CLI login, refresh the authorization instead:
# gh auth refresh --scopes project

python scripts/planning/backlog.py
python scripts/planning/projects.py --project release
python scripts/planning/projects.py --project release --apply

# Then create or populate individual area and portfolio boards:
python scripts/planning/projects.py --project A18 --apply
python scripts/planning/projects.py --project portfolio --apply
# Or process every definition in bounded, resumable batches:
python scripts/planning/projects.py --project all --apply
```

The dry run needs no credentials. Apply uses `GH_PROJECT_TOKEN`, then `GH_TOKEN`, then the existing `gh auth token` result in memory. Never paste tokens into issue bodies, commit them, or put them in command-line arguments. The required authorization is described in [GitHub's Projects API guide](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects).

An optional manual `parity-projects.yml` workflow accepts a securely configured `SHARPFORGE_PROJECTS_TOKEN` Actions secret. It has no push or pull-request trigger and does not request the secret in chat. The secret is optional and was not created as part of this change. After the workflow is available on the default branch, a maintainer can run it explicitly.

### Safe resume and adoption

Apply limits writes to 400 per invocation by default (`--max-writes 1..450`) and exits **2** when the batch is partial. Rerun the same command; existing membership, fields and matching metadata are skipped. Do not interpret a partial batch as success. `planning/generated/projects-audit.json` records created URLs, completed read-back, write count and partial/incomplete status.

Projects carry stable README markers. An existing unmarked project with the same title is **not automatically adopted or duplicated**. Inspect its URL and provide an explicit JSON binding to the owner's project number:

```json
{"release": 17, "A18": 22}
```

Those numbers are examples, not provisioned project IDs. Pass the file using `--bindings your-reviewed-project-bindings.json`. A timeout between project creation and marker writing can leave an unmarked project; resolve it the same way. Closed projects are not reopened automatically. The script never changes project visibility or overwrites an adopted project's README.

The same issue must remain in its canonical area board. Preserve the original native parent hierarchy, including subtask parents for the four release slices. Rust remains part of full parity: SF-A26-T06 is parent context for 0.15, while SF-R015-T03 can ship the current JS/SIMD profiles without waiting for SF-A27.

### Agent tracking and views

The provisioner creates ten text fields:

`SF Work ID`, `SF Area`, `SF Release`, `SF Role`, `SF Dependencies`, `Agent`, `Branch`, `Lease expires`, `File locks`, `Evidence`.

It initializes only the five `SF` metadata fields. Existing nonempty conflicting metadata is not overwritten. `Status`, assignees, Agent, Branch, lease/lock/evidence values and unrelated project items are preserved. It reads back membership and metadata before recording a board as verified.

The README on newly created projects suggests these views; **custom views are not created by the script**:

- Release: filter `SF Release=0.15`, group by `SF Area`.
- Agents: group by Agent, show Status, Branch, Lease expires, File locks and Evidence.
- Blocked: inspect native issue dependencies and prerequisite evidence.
- Epics: native sub-issue rollups; do not count an epic and its children as separate delivered work.

## Parallel-agent protocol

A00 owns shared ABI/registry/integration seams. A19 owns workbench document/session services and shell CSS; A18 consumes those seams for the designer. A17 owns drawing, A10 numerical execution, A11 managed scheduling, A12 transports, A25 Git, A26 application export and A29 qualification. Existing shared dispatchers and registry files require an integration handoff, not simultaneous area edits.

Claim one leaf with agent identity, branch, exact file locks, lease/heartbeat, dependencies and last verified commit. Parent/child workers must not both change the same implementation. A card marked In Progress is **not an atomic claim lock**: the A00 claim/lease and ownership-enforcement tasks remain implementation work. Until they are implemented, maintainers coordinate claims explicitly in the issue and board.

Readiness requires merged and qualified prerequisites, not merely another agent starting a task. Handoffs include exact commands, environment, artifacts, failures and remaining work. Close a leaf only with merged evidence. Delivering a narrow release slice does not close its broader full-parity parent.

## Validation boundary

Unit tests cover offline plan/selection validation, DAG checks, resumability, native-link planning, field/membership behavior and preservation of existing user state using labeled fake clients. Hosted issue provisioning separately checks real GitHub parent/blocker/label state and repeats the operation. Native Projects access requires a successful project-scoped run and audit. Neither planning tests nor issue creation prove product, provider OAuth, downloaded app, native SDK or physical-GPU parity.
