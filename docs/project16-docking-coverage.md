# Project 16: docking, lazy tools, and editor performance evidence

## Docking review scope

Review04 contains the docking, navigation, Watch and lazy tool source modules and their focused tests. Studio bootstrap wiring, actual Studio browser workflows, standalone bundling changes and A20 performance drivers remain in the dependent composition layer. Qualification records below describe the original completed source batches; no tests or builds were rerun for this review branch. The standalone docking DOM fixture is present and uses built assets with the production server/CSP, but remains unrun. See [project16-workbench-review.md](project16-workbench-review.md) for the exact scope and host contracts.

This ledger records the assigned source scope and its verification boundary.
The root integration branch owns Studio composition, manifests, CI scheduling,
upstream synchronization, project claims, and stacked pull requests. Browser and
native qualification are not inferred from model tests.

| Issue / work ID | Implemented behavior and source | Evidence / boundary |
| --- | --- | --- |
| #1533 / SF-A19-T03.1 | Single preview slot per document group; activation and edit promotion (`workbench/tabs`) | Concurrent preview navigation and edit tests in `a19-03-document-tabs.test.js` |
| #1534 / SF-A19-T03.2 | Pin/unpin, retained pin state, preview promotion; unchanged edits skip host redraws | Persistence and 100-edit notification regression tests |
| #1535 / SF-A19-T03.3 | Document tab context menu, close variants, split/move/reveal/copy actions | Tab policy and menu command tests; real DOM fixture provided |
| #1536 / SF-A19-T03.4 | Save/Discard/Cancel preflight across dirty buffers; shared secondary views | Cancel, save failure, prompt race, shared-view close, reopen tests |
| #1537 / SF-A19-T03.5 | Ctrl+Tab MRU overlay and modifier-release activation | Navigation ordering tests; browser keyboard qualification pending |
| #1538 / SF-A19-T03.6 | Tab overflow, reorder, close/reopen with selection/scroll state | Reorder and reopen tests; overflow DOM fixture pending browser |
| #1539 / SF-A19-T03.7 | Document/window group navigation and history; split shared views | Navigation tests and Studio secondary-focus sync regression |
| #1540 / SF-A19-T04.1 | Nine explicit docking guides, group/root edges, preview bounds | Model edge tests; actual pointer fixture covers every target but is unrun |
| #1541 / SF-A19-T04.2 | Four auto-hide shelves, hover/click flyout, resize and exact pin return | Model anchor tests and actual DOM flyout fixture |
| #1542 / SF-A19-T04.3 | Floating tab groups and nested split topology, redock/center merge | Topology and atomic undo tests; actual float/redock fixture |
| #1543 / SF-A19-T04.4 | Popout focus/keyboard forwarding, exact content identity, close/watchdog return | Source lifecycle review and real popup fixture; browser execution pending |
| #1544 / SF-A19-T04.5 | v1→v2 schema migration, bounded persisted state, actionable filtering diagnostics | Schema/migration/model tests and actual secondary-view restore test |
| #1546 / SF-A19-T04.6 | Window maximize/restore and keyboard move/resize/accessibility | Window commands and transaction tests; hardware keyboard qualification pending |
| #1547 / SF-A19-T04.7 | Bounded dynamic tool factories, per-session IDs, persistence metadata | Factory instance/restore tests; root wires actual output/tool providers |
| #1473 / SF-A19-T37 | Named layout save/manage/reset, numbered slots and shortcuts | `a19-window-layouts-navigation.test.js`; layouts retain current documents |
| #1474 / SF-A19-T38 | Window menu commands, close/move/split/navigation/float/popout flows | Command descriptors and model tests; root registers shell contributions |
| #1575 / SF-A19-T10.3 | Docking pointer events for mouse, touch and pen; explicit large targets | Actual touch-event browser fixture supplied; touch/pen hardware unqualified; tree scope belongs to shell |
| #1580 / SF-A19-T11.3 | Five heavyweight Studio modules and controllers activate only on use; explicit facades/configuration; closed deferred standalone graph and four actual worker payloads | 26 combined focused lazy/bundling/focus/CSP tests and full normal/standalone builds pass; browser first-use fixture unrun; no measured cold-start result claimed |
| #1641 / SF-A20-T12.1 | Real 1 KiB, 1 MiB, 10 MiB and 100 MiB model latency; raw p50/p95/p99; actual browser input-to-two-RAF harness | Measured Node baseline committed; browser baseline absent because Chromium unavailable |
| #1642 / SF-A20-T12.2 | Explicit-GC retained source/buffer, model, undo, bounded tokens and visual-line memory | Measured four-size baseline and all predeclared budgets pass; no DOM/native memory claim |
| #1643 / SF-A20-T12.3 | Strict environment/raw-sample validation; fail any p95 regression above 20% | Actual CLI rejection at 21% and self-comparison pass; root owns CI schedule and runner calibration |

The supplied inventory has no #1545 leaf in this scope. No issue or acceptance
claim is invented for that gap. Parent T03/T04 tracking rolls up these leaves.

## Verification records

The completed docking batch initially passed 53 focused unit tests. The preview
dirty-state optimization passed all nine tab tests. The combined final docking
regressions and editor performance harness checks passed 33 focused tests. The
completed lazy activation and Studio focus scope passed all 12 focused tests using
the serial resource-limited wrapper; all new modules meet the source size limits. The
latency and retained-memory commands ran sequentially and produced the committed
JSON records in `docs/performance`; they used a shared agent machine, not an
isolated performance runner. See `docs/performance/editor-benchmarks.md` for exact
runtime, hardware, raw distributions, budgets, and the distinction between Node
model timings and browser paint timings.

The supported Playwright Chromium installation failed after all automatic
download attempts. Browser fixtures and benchmark adapters are committed but no
browser or native qualification artifact is fabricated. CI and a browser-equipped
runner must execute those remaining gates before claiming those acceptance
criteria complete. Full repository validation is owned by root and runs only
after complete scopes are integrated, following the serial low-memory guidance.
