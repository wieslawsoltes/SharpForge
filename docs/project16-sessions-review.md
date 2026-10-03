# Project 16 sessions and runtime review scope

This layer supplies reusable document, project-build, application-session and
startup services, together with real runtime argument/environment support.
The final Studio root, docking and shared shell tools are composed in the next PR.

## Stack and source identity

| Role | Revision or branch |
| --- | --- |
| Immediate editor dependency | `f1297b26b2459e36299914de52290aacaa93ecd6`, `codex/project16/02-editor` |
| Review branch | `codex/project16/03-sessions-runtime` |
| Planned PR base | `codex/project16/02-editor`; use `main` after that dependency merges |
| Original clean session closure | `42b8adc0` |
| Clean closure merge in this worktree | `c971d096718741c8aa870b69ebc55e82bc840fc2` |
| Final source snapshot for scoped imports | `cb0278e55ca6e0934f96d5decdd4e53716101baa` |

The clean closure preserves the original logical commits from `90f1eab3` through
`42b8adc0`: worker connections, build isolation, application ownership, breakpoints
and locks, document/state facades, startup orchestration, and session controls.
It was merged normally with no conflicts. Later source was copied into forward
commits because its original branch ancestry also contains final Studio/docking
composition that does not belong in this review layer.

The principal follow-up provenance is `ea9d89d1` (lazy shared document models),
`6cc8fb1e` (executable cache ownership), `10007521` and `370a7dfb` (runtime/compiler
launch contract and real workers), `0b30d3dd` (portable recovery), `ed920595`
(explicit runtime settings target), and `bc3580c3` plus `ad62b560` (state ownership
and synchronous profile-selector correction).

No uncommitted root files, prepared document ingress/save follow-up, editor
streaming reader or column-index changes were imported. Editor review files and
its corrected standalone examples remain unchanged.

## Included responsibilities

| Responsibility | Implementation | Evidence files |
| --- | --- | --- |
| Restartable worker transport and ordered identity | `workbench/worker-client.js`, `state-events.js` | `a19-worker-client.test.js` |
| Lazy authoritative documents, per-view state, dirty/save races and unopened-document locks | `workbench/documents.js`, `document-locks.js`, `state.js` | `a19-documents-state.test.js`, `a19-document-models.test.js` |
| Per-project compiler/cache/cancellation, dependency build queue, diagnostic producers and output rings | `workbench/build*.js`, `diagnostics-store.js`, `output-channels.js` | `a19-build-output.test.js` |
| Application worker ownership, active/background routing, composite identities, scoped breakpoints and grants | `workbench/app-session.js`, `session-*.js`, `sessions.js` | `a19-app-sessions.test.js`, `a19-session-tools.test.js`, `a19-session-state-ownership.test.js` |
| Startup modes/order/actions, selected project profiles, independent launch outcomes and recovery | `workbench/startup-*.js`, `launch-*.js`, `session-recovery.js` | `a19-startup-orchestration.test.js`, `a19-profile-selection.test.js`, `a19-session-recovery.test.js` |
| Session application panels, Process/Thread/Frame controls and status presentation | `workbench/application-window.js`, `processes.js`, `debug-location.js`, `session-status.js` | `a19-session-tools.test.js`, underlying worker fixtures |
| Explicit profile/application runtime tool target and legacy host fallback | `runtime-tools.js`, `workbench/session-runtime-bridge.js`, `session-runtime-view.js` | `a19-runtime-settings-bridge.test.js` |
| Program argv and immutable environment in source VM and direct CIL, including actual worker transport | `runtime.worker.js`, `workers/runtime-launch.js`, package changes below | `a19-runtime-arguments.test.js`, `a19-runtime-environment.test.js`, `a19-runtime-launch-options.test.js`, `a19-runtime-worker-launch.test.js`, `a19-builtin-extensions.test.js`, `a19-multi-session-fixture.test.js` |

Application paths in the table are under `apps/studio/`; test names are under
`tests/`. The original 28-leaf issue mapping is retained in
`docs/a19-session-evidence.md`, with deferred composition qualifications explicit.

## Required package changes

| Package | Why it is required in this layer |
| --- | --- |
| `@sharpforge/project-system` | Validate and round-trip portable startup/selected-profile metadata in ZIP and folder manifests; exports sanitizers and one immutable schema contribution table. |
| `@sharpforge/runtime` | Validate and privately copy bounded argv/environment options, marshal program argv into source and CIL entry points, and publish actual launch capability flags. |
| `@sharpforge/compiler` | Forward argv through both bound/legacy and semantic startup generation, including static/module startup and async Main. |
| `@sharpforge/bcl-core` | Register the read-only `System.Environment.GetEnvironmentVariable(string)` implementation used by both JavaScript engines. |
| `@sharpforge/bytecode` | Preserve sparse reserved slots when copying the builtin registry for extension registration; released IDs keep their meaning. |

These use existing public package boundaries and introduce no runtime dependency.
Existing WinUI, debugger, network and archive packages supply rendering, debugger
execution, grant validation and serialization. They are dependencies of the
service/worker graph and are not modified in this layer. Existing A00 and A07
registry tests are updated with the qualified extension registration contract;
their owning manifests remain unchanged.

## Qualification evidence and review limits

The source worktree completed the implementation scopes before validation:

- Original session foundation: 48 focused tests passed.
- Final launch-boundary rerun: 139 passed, zero failures/skips, after correcting
  the defects identified by the preceding complete launch sweep.
- Recovery/runtime-tool scope: 253 cases ran, 252 passed and one profile-selector
  regression was found. After the fix, the entire affected profile-selection
  file passed 3/3; the remaining 250 cases required no changes and had passed.
- Combined WinUI scene/argv/environment fixture: 2/2 passed through real source
  and CIL runtime workers at `57cfe48d`, using the included C# window fixture.
- Released ABI snapshot and BCL inventory checks passed in the source worktree.

These are historical results, not a new combined pass count for this review
branch. The exact commands, Node version, durations, failures and correction
provenance remain in `docs/a19-session-evidence.md`. No heavy validation, build,
browser run or benchmark was repeated while materializing this layer.

The Node worker fixture executes the actual production runtime worker with only
the browser message transport adapted to `node:worker_threads`. Its two engines
are the source VM and direct managed CIL interpreter. Fake-worker service tests
qualify service identity/cancellation behavior; they do not establish compiler,
WinUI browser, native CLR/Wasm or Visual Studio visual parity.

The required static check found an unreviewed dynamic import in that fixture.
Its loader now statically imports a Node transport initializer before the
unchanged production runtime worker, then connects incoming messages only after
the production handler exists. The ready event and request/event transport keep
their existing shape. No dynamic-code audit exception was added.
After this complete correction, `node scripts/limited.js npm run check` passed:
30 manifest areas, 447 Node files, 25 browser scripts, zero unassigned or duplicate
tests; 1,882 JavaScript modules with zero syntax errors; and all 1,878 inspected
modules passed the import/dynamic-code audit. No tests or build were rerun for
this static correction.

The actual Studio multi-session browser fixture and the repository-wide
`state.debug` ownership assertion require the final composition. They remain in
the next layer. This branch retains the three independent ownership-checker
cases unchanged and does not register either unavailable composition test.
The initial clean-closure browser fixture created a parallel service graph next
to Studio; it is excluded in favor of the later actual-Studio fixture.

`tests/manifests/A19.json` registers 17 present focused A19 files plus the two
existing `docking.test.js` and `release08-commands.test.js` regression entries.
Its existing `browser_test.py` entry is retained; no new browser suite is
registered. The A00/A07 registry tests retain their original manifest ownership,
and the entire A20 manifest from the editor dependency is unchanged.

Static inspection parsed and linked 60 roots across 822 modules without
evaluating project code. Those roots include all 32 workbench modules, the
runtime tools, actual compiler/runtime worker entries, the Node worker adapter,
the relevant package entries and registered Node tests. All named exports and
imports resolve. Manifest paths exist, there are no cross-manifest duplicates,
and product JavaScript copied for this layer matches committed `cb0278e5`
byte-for-byte. This is syntax/dependency inspection, not a new test or build pass.

Program arguments are distinct from raw explicit CIL method parameters. Launch
environments are copied, immutable, case-sensitive and never inherit host OS
values. Missing names return null and empty values stay empty. No environment
mutation or user/machine overload is implemented. Runtime capability records
reject unsupported nonempty options. Exported recovery data omits argv,
environment values and network grants. Native process attachment/detachment,
native permission dialogs and browser render/latency targets remain unqualified.

## Main synchronization after the editor dependency merged

This branch merges public main
`1645ff4ffeaf18a47206219d8abed8aea8f95bc8` with both parents preserved.
The four conflicts were resolved by keeping main's extracted sparse builtin
registry and equivalent occupied-slot assertions; retaining the argument-aware
compiler startup extraction while using main's `DiagnosticId` constants; and
retaining launch argument/environment initialization alongside main's CIL native
numeric ABI, event and cache changes. No released ID was reassigned, and no
dynamic-code allowance was added. The original source-scope evidence above is
historical; this synchronization does not claim a new runtime test or build pass.

Main now registers `StringBuilder.AppendFormat(string, object[])` at extension ID
524288. Its existing order and released ID are retained. The unpublished
environment contribution automatically appends at 524289 through that registry;
its generated BCL documentation row was corrected to match. No dispatch code or
released golden fixture required an ID change.

After the complete conflict resolution, `node scripts/limited.js npm run check`
passed once: 30 areas, 539 Node files, 25 browser scripts, zero unassigned or
duplicate tests; 2,177 syntax-checked JavaScript modules with zero errors; and
2,173 modules passing the import/dynamic-code audit. Runtime tests and builds
were not repeated for this synchronization.
