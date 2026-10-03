# Project 16 A19 session foundation evidence

This ledger covers the 28 A19 leaves assigned to the session/build/document worktree. Module names follow the repository's implemented service seams; where an issue proposed a different filename, the corresponding exported responsibility is identified below. Studio integration, docking interaction and the shared tool-window UI are composed by the integration worktree. Evidence here distinguishes model/worker execution from browser qualification.

## Review03 scope and provenance

`codex/project16/03-sessions-runtime` stacks on editor review `f1297b26`. It merges
the original clean session closure `42b8adc0` and imports the qualified session,
runtime and project serialization follow-ups from committed integration snapshot
`cb0278e5`. No uncommitted source, final Studio composition, docking/shell
implementation or prepared document-ingress follow-up is included.

All execution results below were recorded in the implementation worktree; no
tests or build were rerun while materializing review03. The actual Studio
`browser_multi_session_test.py` and all-Studio ownership-scan case belong to the
next composition layer. The three independent ownership-lint cases are retained
unchanged in `tests/a19-session-state-ownership.test.js`. The original browser
fixture in the clean closure created a second service graph beside Studio and is
not published as evidence for the actual application composition.

`docs/project16-sessions-review.md` records the exact dependency and manifest
boundaries. References below to the actual Studio browser fixture or full
ownership-scan test describe deferred composition evidence, not files in this PR.

## Per-issue implementation and evidence

Paths in the source column are relative to `apps/studio/workbench/` unless otherwise specified. Test paths are relative to `tests/`.

| Issue / work ID | Implemented source | Focused evidence | Remaining integration qualification |
|---|---|---|---|
| #1515 SF-A19-T01.1 | `worker-client.js`, `state-events.js`; Studio imports through the service composition | `a19-worker-client.test.js`: request errors, timeout, restart, generation filtering, disposal, middleware and subscriptions | Root core/browser check for the actual Studio composition |
| #1516 SF-A19-T01.2 | `state.js`, `sessions.js`: explicit document/build/session/UI slices and keyed facade | `a19-documents-state.test.js`: former key enumeration and isolated slice updates | Full existing Studio behavior is covered by root's consolidated suite |
| #1517 SF-A19-T01.3 | `documents.js`: document lifecycle, dirty baselines, model ownership, per-view editors | `a19-documents-state.test.js`, `a19-document-models.test.js`: shared model/undo, lazy text events, open/close/save, save races and editor disposal | Actual docking tabs and native save provider are root/view-agent integration; large-file prepared ingress is a separate integration follow-up |
| #1518 SF-A19-T01.4 | `build.js`: one compiler/cache/cancellation domain per project; executable cache separate from analysis | `a19-build-output.test.js`: concurrent A/B builds, stale A rejection, B preservation and analysis/cache regression | Consolidated compiler worker/browser check |
| #1519 SF-A19-T01.5 | `app-session.js`: worker generation, debug/output/watches/frame/grants per app | `a19-app-sessions.test.js`, `a19-runtime-worker-launch.test.js`: independent fake and actual worker state/output, composite identity and stop isolation | WinUI browser fixture |
| #1520 SF-A19-T01.6 | `session-manager.js`: ordered events, active/recent selection, resource ownership | `a19-app-sessions.test.js`: selection, ending active app, independent lifecycle, limits | Actual process selector/browser interaction |
| #1521 SF-A19-T01.7 | `session-compat.js`, `state.js`; `scripts/quality/session-state-ownership.js` | `a19-app-sessions.test.js`, `a19-documents-state.test.js`, `a19-state-ownership.test.js`: identity-safe facade and owned-path write gate | Existing suite must pass on root's final integrated source |
| #1522 SF-A19-T01.8 | `session-events.js`: active/shared and background-only routing | `a19-app-sessions.test.js`: background events preserve active identity/tools callback routing | Editor execution line/panel behavior in actual Studio browser fixture |
| #1523 SF-A19-T01.9 | `document-locks.js`: project membership and shared URI locking, including unopened models | `a19-app-sessions.test.js`, `a19-document-models.test.js`: A locks only A/shared documents; B remains writable | Visible editor read-only behavior in browser |
| #1524 SF-A19-T01.10 | `browser_multi_session_test.py`; real worker test support under `fixtures/a19/` | `a19-runtime-worker-launch.test.js` executes both source and direct CIL workers with independent argv/environment/output; browser fixture moved to actual Studio by editor-insight agent | Browser fixture must run against final built Studio; service/worker tests alone are not a browser pass |
| #1525 SF-A19-T02.1 | `startup-config.js`, `session-recovery.js`; project-system settings registration and manifest seam | `a19-startup-orchestration.test.js`, `a19-session-recovery.test.js`: deterministic modes/order, unknown/library rejection, prospective atomic restore and ZIP/folder persistence | Root persistence wiring after project synchronization |
| #1526 SF-A19-T02.2 | `startup-dialog.js`; registered host callbacks | `a19-startup-orchestration.test.js`: configured startup order and two starts; dialog provides labeled action/order controls | Project/solution menu reachability and F5 in actual Studio |
| #1527 SF-A19-T02.3 | `launch-orchestrator.js`, `build-queue.js`: dependency order, independent root failures, cancellation tokens | `a19-startup-orchestration.test.js`, `a19-build-output.test.js`: failing B does not prevent independent A | Root launch UI routing |
| #1528 SF-A19-T02.4 | `application-window.js`: one WinUIHost and panel callback per app | `a19-runtime-worker-launch.test.js` covers underlying worker identity; editor-insight agent's actual two-window fixture qualifies renderer plus argv/environment | Actual browser docking side-by-side and close confirmation belong to combined docking/session qualification |
| #1529 SF-A19-T02.5 | `launch-profiles.js`, `startup-target.js`, `session-runtime-bridge.js`; runtime launch validators, worker adapter, both compiler startup paths and BCL environment contribution | `a19-runtime-arguments.test.js`, `a19-runtime-environment.test.js`, `a19-runtime-launch-options.test.js`, `a19-runtime-worker-launch.test.js`, `a19-runtime-settings-bridge.test.js`, `a19-profile-selection.test.js`, `a19-session-recovery.test.js` | Root profile editor and toolbar browser check; native CLR/Wasm environment launch not claimed |
| #1530 SF-A19-T02.6 | `session-commands.js`, `session-manager.js`, `app-session.js` | `a19-startup-orchestration.test.js`, `a19-app-sessions.test.js`: restarting/stopping A preserves B identity; explicit new-instance uses selected profile | Root menus and Processes row actions in browser |
| #1531 SF-A19-T02.7 | `startup-target.js` | `a19-profile-selection.test.js`: target DOM events select project/profile, next launch receives that profile, no-debug action retained | Actual toolbar/F5 browser interaction |
| #1532 SF-A19-T02.8 | `session-manager.js`, `processes.js`, `app-session.js` resource summaries | `a19-app-sessions.test.js`, `a19-startup-orchestration.test.js`: bounded 1–64 configured limit, refusal preserves live apps, cleanup | Visible Processes heap/worker values in browser |
| #1554 SF-A19-T06.1 | `output-channels.js`: named bounded channels and per-app ring buffers | `a19-build-output.test.js`, `a19-runtime-worker-launch.test.js`: limits and independent program output | Shared Output tool dropdown is shell-agent UI; actual browser isolation fixture |
| #1555 SF-A19-T06.2 | `diagnostics-store.js`, `build.js`: per-project/producer/revision diagnostics | `a19-build-output.test.js`: B cannot clear A; project removal/limits/stale producers | Root/shell Error List wiring and producer updates |
| #1556 SF-A19-T06.3 | `build-reveal.js`: user-intent and active-project/session reveal policy | `a19-build-output.test.js`: background work and superseded intent cannot reveal | Root shared tool focus behavior in browser |
| #1557 SF-A19-T06.4 | `build-decorations.js`: startup/running/paused/build state and accessible descriptions | `a19-startup-orchestration.test.js`: startup/running counts and accessible name | Root Solution Explorer event subscription and visible badges |
| #1558 SF-A19-T06.5 | `build-queue.js`: ordered jobs, per-project cancellation, outcome counts and summary output | `a19-build-output.test.js`: dependency order, cancellation, succeeded/failed/skipped summaries | Root build cancellation command/UI |
| #1559 SF-A19-T07.1 | `debug-location.js`: process/thread/frame selection, captured identity, async response guards | `a19-session-tools.test.js`: process selector events, thread/frame locals, background navigation isolation and missing locations; underlying identity tests in `a19-app-sessions.test.js` | Actual process/thread/frame dropdown and execution-line browser qualification; no separate visual-oracle pass claimed |
| #1560 SF-A19-T07.2 | `processes.js`: rows expose state/engine/debugging/heap/worker and close over row session | `a19-session-tools.test.js`: row Break/Continue/Stop/Detach/Restart DOM events preserve the other app; `a19-startup-orchestration.test.js`: explicit command context | Actual browser row interaction and visual qualification |
| #1561 SF-A19-T07.3 | `session-breakpoints.js`: one project user list and per-session binding results | `a19-app-sessions.test.js`: edits sent only to owning-project sessions, separate bound/hit state | Root breakpoint UI and worker breakpoint suite |
| #1562 SF-A19-T07.4 | `session-settings.js`, `session-runtime-bridge.js`, `session-runtime-view.js`, `apps/studio/runtime-tools.js` | `a19-app-sessions.test.js`, `a19-runtime-settings-bridge.test.js`: exact-origin policy, independent copies, session/profile selector, future launch/restart settings and scoped revocation | Root settings-provider wiring and actual tool browser interaction; no host OS network grant behavior claimed |
| #1563 SF-A19-T07.5 | `session-status.js`: combined counts/state and deduplicated live-region text | `a19-app-sessions.test.js`: combined application status/counts; `a19-session-tools.test.js`: status/title/live-region text changes once per meaning change | Root status/title/ARIA browser and accessibility qualification |

## Recorded execution

- Original complete foundation batch: 48 focused tests passed. Subsequent model/document/cache source was integrated before the complete launch scope validation.
- Complete launch sweep: 461 cases ran; 440 passed and 21 identified startup/registry fixture defects. Those failures were fixed in the launch scope, not downgraded or skipped.
- Final launch-boundary rerun: **139 passed, 0 failed, 0 skipped** in 14.5338 s on Node 24.19.0, through `node scripts/limited.js node --test --test-concurrency=1 tests/a19-runtime-*.test.js tests/a19-startup-orchestration.test.js tests/a07-13-registry.test.js tests/compiler-entry-point.test.js tests/compiler-csharp9-rules.test.js tests/compiler-top-level.test.js tests/release09-worker.test.js tests/managed-il.test.js`.
- `node scripts/planning/snapshot-contract-ids.js` passed the released ABI check; the upstream builtin range correction was reused. The environment method is allocated through the existing extension registration range, with no released contract ID reassignment. `node packages/bcl-core/scripts/inventory.js --check` passed.
- Recovery/runtime tool integration scope, after merging integration commit `49750889`: **253 cases, 252 passed and one profile-selector regression found** in 8.3622 s. The profile-change handler emitted a synchronous profile event that rebuilt the selector before it reread the selected value. Capturing the intended profile/action before notification fixes that defect; the entire affected `a19-profile-selection.test.js` file then passed **3/3, zero skips** in 0.3337 s. The remaining 250 cases needed no changes and had already passed.
- The scope command was `node scripts/limited.js node --test --test-concurrency=1 tests/a19-session-recovery.test.js tests/a19-profile-selection.test.js tests/a19-session-tools.test.js tests/a19-state-ownership.test.js tests/a19-runtime-*.test.js tests/a19-worker-client.test.js tests/a19-documents-state.test.js tests/a19-document-models.test.js tests/a19-build-output.test.js tests/a19-app-sessions.test.js tests/a19-startup-orchestration.test.js tests/project-system.test.js tests/templates-archive.test.js`. It includes ZIP/folder settings round trips, all original A19 foundation tests, real worker launches, the owned-path lint scan, and direct Processes/Debug Location/status control events. `git diff --check` passed. The integration owner records final core/browser results separately.

## Scope and limits

Both JavaScript engines execute the argv/environment fixtures: the source VM and direct managed CIL interpreter. Real production worker transport is exercised through a Node worker harness. The browser fixture is owned by the integration/editor-insight agents and must be reported separately after it runs against the built Studio. Neither a native CLR/Wasm launch test nor a Visual Studio visual oracle was run in this worktree.

Program argv is separate from explicit managed method parameters, bounded to 1,024 strings / 1,048,576 UTF-16 code units total with 65,536 units per string. Per-launch environment data is an immutable, case-sensitive map with 256 keys maximum and explicit per-name/value/total limits. The managed surface added is `System.Environment.GetEnvironmentVariable(string)` only: no process mutation, host OS environment, user/machine overload, or hidden import of credentials. Unsupported launch targets must report their capability rejection explicitly.

No speedup is claimed. The runtime builtin table correction came from upstream main unchanged; an additional benchmark of that unrelated correction was not run. Local focused tests use the repository's bounded resource wrapper. Full epic/CI validation and stacked PR publication remain the integration owner's responsibility.
