# Project 15 acceptance coverage

This is an implementation audit of all **103 issues** in the Project 15 specification snapshot supplied on 2026-10-03.
It is not a passing test report, a claim lease, a project-status update, or permission to close issues.

The inspected assembled tree is `5124029fc7a4523e8d11ea01265e11f56f6f764f`.
The session-disposal correction `92f0e7efa5a9162417683e9c7e29845d4aa87a40`, subsequently merged into
`1caa6889`, was also reviewed. Later changes must be qualified at the final integrated commit.
The audit used the exact issue bodies in `project15-all.json`, then followed the production UI calls into their package APIs.
No product files, planning gates, leases, branches owned by other contributors, or remote state were changed during this audit.
No tests or benchmarks were run during the audit; the user requested qualification after the complete scope is assembled.

## How to read the map

- **Present**: the production path and relevant tests exist. Integrated execution is still pending unless a separately pinned report says otherwise.
- **Gap**: a concrete missing or incorrect behavior was identified below and sent to the coordinator immediately.
- **Pending**: an already assigned integration correction was in progress when this tree was inspected.
- **Restricted**: authoring or preview exists, but an explicit target or source-ownership restriction prevents the full requested workflow.
- **Gate**: the implementation exists, but the acceptance criterion is a measured or executed result that has not been established for this tree.
- **Roll-up**: a parent tracker. It is not an additional delivered capability and cannot close before its children have merged evidence.

References below use repository-relative paths. A test reference identifies authored coverage, not a claim that the test passed here.
Most file groups have focused positive, refusal, boundary, and cancellation/disposal cases. Browser, source VM, direct CIL,
Rust, and native WinUI results must remain separately identified.

## Concrete gaps found in the assembled UI

| ID | Issues | Observed behavior and required correction |
| --- | --- | --- |
| G1 | #1684, #1689, #256 | `source-edit-tree.js` removes obsolete attached properties from the planned document on reparent. `DesignerSourceSync.applyPlan()` instead accepts the pre-plan `design` and overwrites `plan.analysis.document` with it. The source can remove Canvas.Left/Top while the surface/baseline still retain them and report synchronized. Accept the compiled, normalized plan document and preserve only compatible design metadata/runtime identities. |
| G2 | #1691, #1650 | `DesignerSurfaceController.doubleClick()` always begins inline text, except component navigation. The Events rows have New and Go buttons but no double-click action. Normal control/event-row double-click therefore does not create or open the default handler. Preserve F2/slow-double-click text editing while supplying the requested handler gesture. |
| G3 | #1697 | Adorners expose four anchor toggle buttons. `DesignerSurfaceGestures.pointerDown()` immediately toggles an anchor and returns; exported `setDesignMargin()` has no Studio caller. Dragging an anchor does not edit Margin. |
| G4 | #1698 | Geometry keys use a temporary session and one commit. Repeated Alt+arrow order keys instead call `reorderDesignSelection()` and `document.change()` for each key event. Held order keys do not coalesce into one undo step. |
| G5 | #1660 | `designerControlName()` has no insertion caller. `DesignerTools.naming` is assigned but Toolbox click/draw insertion ignores it. New-document snap is overwritten by the default guide grid of eight. Save-and-apply-now writes `view.autoSync`, although synchronization reads `view.sourceSync.auto`. Wire preferences to the actual insertion, guide, and sync owners. |
| G6 | #1653 | Geometry zoom helpers permit 800%, but `DesignerSession` normalizes every zoom assignment to at most 400%. The same session clamps snap to 1–64 while guides allow 0.25–1024. Align the session and UI ranges; test the real session path as well as the pure helper. |
| G7 | #1652 | Guides live in `document.designer.guides`. Source projection strips this metadata, C# Save only writes source, and session recovery stores view state and selection without guide coordinates. Guides persist in saved design JSON but disappear on reloading an ordinary C# document. Add bounded, validated per-URI guide recovery after source initialization. |
| G8 | #1682 | AbortControllers guard stale commits, but `analyzeDesign()` does not pass a signal through the two-argument inline `WorkerClient.request()`. The worker has no cancellation request/context. A superseded result is rejected, but its queued analysis is not cancelled. Add a bounded abortable request/coalescing seam; do not claim that synchronous compilation can be preempted. |
| G9 | #1674 | The geometry script is registered in A18's browser manifest. `npm run test:browser` still resolves to `a19:test:browser`, which runs only `tests/browser_test.py`; its task does not invoke the geometry harness. The explicit npm-command wiring criterion remains open. |
| G10 | #1654 | The Edit text menu is enabled for any single unlocked nonroot node, including controls without editable Text/scalar Content; invocation then throws. Go to handler checks only `node.events`, leaving protected source-only lambdas unavailable even though the Events panel supports navigation. Derive enablement from the same text/event capabilities used by execution. |

The coordinator had already assigned the following corrections; they were not rediscovered as unowned work:

- Resource-class gallery/source hosting and typed scalar resource editors, including protection of the dictionary's preview scaffold.
- Project-root registry/catalog integration and the restricted inherited-component preview in source commit `e9f52cbd`.
- Canvas-to-Grid conversion in the replacement Layout panel.
- Live Items projection/preflight, source evidence, and custom Toolbox tab UI.
- Session-owned document disposal, reviewed in `92f0e7ef` above.

## Evidence groups

| Key | Production code and focused coverage |
| --- | --- |
| S | `packages/designer/src/designer-session.js`, `session-registry.js`, `compatibility.js`; Studio `designer-documents.js`, `designer-document-view.js`, `designer-split-view.js`, `designer-tool-router.js`, `designer-commands.js`, `designer-layout-migration.js`; `tests/a18-session-*.test.js`, `tests/browser_designer_documents_test.py`. |
| C | Studio `designer-command-buttons.js`, `designer-command-bar.js`, `designer-command-surface.js`, `designer-chrome.js`, `designer-chrome.css`, `designer-toolbox.js`, `designer-outline.js`; `tests/a18-chrome-{styles,toolbox,outline}.test.js`, `tests/browser_designer_geometry_test.py`. |
| R | `packages/designer/src/source-{analysis,symbols,reader,initializers,collections,identity,literals,plan,edit-tree,edit-properties,edit-resources,handlers,clipboard}.js`; `tests/a18-source-*.test.js`. Ownership is exposed in the analysis/snapshot; dynamic expressions are not evaluated. |
| X | Studio `designer-source-sync.js`, `designer-source-services.js`, `designer-worker.js`, `designer-document-history.js`, `designer-source-events.js`; package `source-protocol.js`; `tests/a18-studio-transactions.test.js`, `tests/a18-source-protocol.test.js`, `tests/a18-document-transactions.test.js`. |
| V | Package `geometry-*.js`, `guides-*.js`, `layout-authoring-*.js`, `spatial-index.js`; Studio `designer-surface-*.js`, `designer-layout-*.js`; `tests/a18-visual-*.test.js`; `packages/designer/examples/visual-layout.mjs`. |
| P | Package `property-*.js`, `resource-*.js`, `design-data.js`, `assets.js`, `designer-options.js`; Studio `designer-property-*.js`, `designer-resource-*.js`, `designer-options-view.js`; `tests/a18-property-*.test.js`, `tests/a18-resource-source*.test.js`; `packages/designer/A18-AUTHORING.md`. |
| M | Package `metadata.js`, `metadata-roots.js`, `toolbox.js`, `toolbox-project-types.js`; Studio `designer-project-roots.js`; metadata/root assertions in `tests/a18-property-design-data.test.js`, `tests/a18-chrome-toolbox.test.js`, `tests/a18-source-roots.test.js`. |
| L | Package `live-attachments.js`, `live-source-binding.js`; Studio `designer-live-*.js`, `designer-app-host*.js`; `tests/a18-chrome-live*.test.js`, `tests/a18-app-host-*.test.js`, `tests/browser_designer_app_host_test.py`. |
| A | Package `accessibility-*.js`, `source-errors.js`; Studio `designer-accessibility.js`, `designer-problems-view.js`; `tests/a18-chrome-accessibility*.test.js`. |
| Q | `tests/a18-qualification-{corpus,fuzz,report}.test.js`, `tests/fixtures/a18/`, `examples/a18-qualification/`, and [qualification.md](qualification.md). |

## Parent scope coverage

| Issue | Scope | Status | Concrete coverage and remaining condition |
| --- | --- | --- | --- |
| [#252](https://github.com/wieslawsoltes/SharpForge/issues/252) | E01 document workflow | Roll-up | S/C/R/X/V; G1–G8/G10 and all child merge evidence remain relevant. |
| [#253](https://github.com/wieslawsoltes/SharpForge/issues/253) | E02 safe editing | Roll-up | V/P/L/A/Q; runtime/source restrictions and child qualification must remain visible. |
| [#254](https://github.com/wieslawsoltes/SharpForge/issues/254) | T02 command chrome | Present | C supplies tokens, SVG commands, overflow, and geometry harness. Theme/density/DPI results need the final browser gate. |
| [#255](https://github.com/wieslawsoltes/SharpForge/issues/255) | T03 source ownership | Present | R binds partial symbols, protects dynamic statements, retains literal trivia, and snapshots ownership. Bounded construction forms are documented. |
| [#256](https://github.com/wieslawsoltes/SharpForge/issues/256) | T04 transactional sync | Gap | X supplies revision/conflict/history paths; G1 and G8 prevent an unrestricted completion claim. |
| [#257](https://github.com/wieslawsoltes/SharpForge/issues/257) | T05 structural source edits | Gap | R/X support named-control insertion, deletion, reparent, rename, events, and clipboard; G2 and normalized acceptance G1 remain. |
| [#258](https://github.com/wieslawsoltes/SharpForge/issues/258) | T06 pixel editing | Gap | V supplies transforms, snaplines, arrangement and exact pointer transactions; G3/G4 remain. |
| [#411](https://github.com/wieslawsoltes/SharpForge/issues/411) | T01 document host | Present | S/X compose permanent per-URI editors, independent sessions, active side panels and recovery. Browser qualification is pending. |
| [#412](https://github.com/wieslawsoltes/SharpForge/issues/412) | T07 layout/responsive | Restricted | V supplies tracks, preview environments and managed adaptive methods. Automatic viewport resize is a required host hook; Canvas-to-Grid restoration was assigned. |
| [#413](https://github.com/wieslawsoltes/SharpForge/issues/413) | T08 property editors | Restricted | P supplies typed editors, value sources, collections, bindings and events. Rich binding/resource/gradient C# application is restricted by the framework target. |
| [#414](https://github.com/wieslawsoltes/SharpForge/issues/414) | T09 styles/templates | Restricted | P supplies transactional resources, scoped templates, state playback and instance strips. Resource-class native compilation is unavailable; gallery integration was assigned. |
| [#415](https://github.com/wieslawsoltes/SharpForge/issues/415) | T10 live applications | Pending | L has explicit app/session/generation channels and source receipts. Assigned live Items and preflight changes need integration and two-app execution. |
| [#416](https://github.com/wieslawsoltes/SharpForge/issues/416) | T11 accessibility | Present | A/C/V supply keyboard intents, announcements, Error List and checks. Actual full keyboard/assistive-technology acceptance remains a gate. |
| [#417](https://github.com/wieslawsoltes/SharpForge/issues/417) | T12 qualification | Gate | Q has 51 fixtures and 1,000 seeded sequences with separately recorded source/CIL results. Re-run at the final assembled commit; old evidence is not new-tree evidence. |
| [#550](https://github.com/wieslawsoltes/SharpForge/issues/550) | E03 tooling parity | Roll-up | Extra tooling tasks below have production paths, specific gaps and measured gates. Do not count this tracker as another delivered feature. |

## Chrome defects and additional tooling

| Issue | Scope | Status | Concrete coverage and remaining condition |
| --- | --- | --- | --- |
| [#1644](https://github.com/wieslawsoltes/SharpForge/issues/1644) | B01 Designer button | Gate | C aligns the main command with its siblings and measures icon/text centres at the requested DPIs. Final DOM evidence is pending. |
| [#1645](https://github.com/wieslawsoltes/SharpForge/issues/1645) | B02 mode labels | Gate | C balances tab geometry; harness measures the 0.5px tolerance and responsive layouts. |
| [#1646](https://github.com/wieslawsoltes/SharpForge/issues/1646) | B03 font shorthand | Present | C uses valid font declarations and has stylesheet rejection coverage for invalid inherited shorthand. Computed-size evidence is a browser gate. |
| [#1647](https://github.com/wieslawsoltes/SharpForge/issues/1647) | B04 root insertion | Present | `toolboxInsertionParent()` descends through full content roots; `insertToolboxControl()` selects the insertion with one transaction. C covers Window/Page/UserControl cases. |
| [#1648](https://github.com/wieslawsoltes/SharpForge/issues/1648) | T13 Toolbox | Pending | C/M supply Common/All/Project/Recent/Pointer and a custom-tab catalog. Assigned custom-tab UI and qualified project descriptors must land. |
| [#1649](https://github.com/wieslawsoltes/SharpForge/issues/1649) | T14 draw/drop creation | Present | V routes Toolbox drag ghosts, snaplines, drawn bounds and Escape through one-commit creation. Actual DOM interaction is pending. |
| [#1650](https://github.com/wieslawsoltes/SharpForge/issues/1650) | T15 inline text | Pending | V copies rendered font metrics, commits once, and cancels on Escape. G2 must reconcile normal handler double-click with slow text double-click. |
| [#1651](https://github.com/wieslawsoltes/SharpForge/issues/1651) | T16 Outline | Present | C keeps eye/lock flags outside generated source, filters marquee/movement, supports rename and before/after/inside drops. |
| [#1652](https://github.com/wieslawsoltes/SharpForge/issues/1652) | T17 guides/grid | Gap | V has draggable guides and snap/grid settings. G7 leaves C# reload persistence incomplete; G5/G6 affect configured defaults/ranges. |
| [#1653](https://github.com/wieslawsoltes/SharpForge/issues/1653) | T18 zoom/pan | Gap | V has pointer anchoring, 10% fit padding, Ctrl+0, wheel and Space pan. Session zoom still caps at 400%: G6. |
| [#1654](https://github.com/wieslawsoltes/SharpForge/issues/1654) | T19 context menu | Gap | V provides the requested commands through one registry. G10 identifies concrete applicability/navigation mismatches. |
| [#1655](https://github.com/wieslawsoltes/SharpForge/issues/1655) | T20 sample data | Present | P stores design-only item data and projects sample rows; source generation excludes it. Tests assert five ListView rows and absence from emitted C#. |
| [#1656](https://github.com/wieslawsoltes/SharpForge/issues/1656) | T21 component roots | Pending | M has root creation/registry projection/navigation. Assigned inherited previews preserve compiler errors and read-only classification; do not claim native construction success. |
| [#1657](https://github.com/wieslawsoltes/SharpForge/issues/1657) | T22 metadata | Present | M derives visual types, schemas, attached setters and child slots from the framework contract; coverage detects missing rendered-control metadata. |
| [#1658](https://github.com/wieslawsoltes/SharpForge/issues/1658) | T23 image assets | Pending | P provides authorized project URIs, thumbnails and bounded object-URL stores. Assigned initial-source/gallery preload follow-up and browser rendering remain. |
| [#1659](https://github.com/wieslawsoltes/SharpForge/issues/1659) | T24 large trees | Gate | V indexes geometry, schedules bounded reads and caps visible adorners. Pure-index timing does not prove 5,000-node selection/drag below 16ms in a browser. |
| [#1660](https://github.com/wieslawsoltes/SharpForge/issues/1660) | T25 options | Gap | P/S persist validated defaults. G5 identifies preferences not reaching their actual owners; G6 affects range consistency. |

## Document and chrome subtasks

| Issue | Scope | Status | Concrete coverage and remaining condition |
| --- | --- | --- | --- |
| [#1661](https://github.com/wieslawsoltes/SharpForge/issues/1661) | T01.1 session extraction | Present | S owns independent documents, selection, view state, source sync, live attachment and disposables; two-session isolation tests exist. |
| [#1662](https://github.com/wieslawsoltes/SharpForge/issues/1662) | T01.2 URI registry | Present | S closes removed URIs and retains switched tabs. `92f0e7ef` adds owned-document disposal after host resources, including failure aggregation. |
| [#1663](https://github.com/wieslawsoltes/SharpForge/issues/1663) | T01.3 compatibility probe | Gate | S probes supported block-bodied construction without a full session. Recorded median 4.299ms/p95 5.568ms is not a universal sub-5ms result. |
| [#1664](https://github.com/wieslawsoltes/SharpForge/issues/1664) | T01.4 view switcher | Present | S wraps compatible source roots and remembers mode by URI; permanent source editors are retained. Resource candidates require worker proof. |
| [#1665](https://github.com/wieslawsoltes/SharpForge/issues/1665) | T01.5 splitter | Present | S uses per-document flex panes, ratio/orientation/swap/collapse and keyboard resize; no docking-model mutation, caret/scroll capture is explicit. |
| [#1666](https://github.com/wieslawsoltes/SharpForge/issues/1666) | T01.6 active tools | Present | S moves the active session's five panel roots and renders a neutral state for incompatible/failed documents. |
| [#1667](https://github.com/wieslawsoltes/SharpForge/issues/1667) | T01.7 retired panels | Present | S migrates old docking references and opens design JSON as a document. Legacy export automation is not a required standalone panel. |
| [#1668](https://github.com/wieslawsoltes/SharpForge/issues/1668) | T01.8 designer commands | Present | S contributes F7/Shift+F7, Open With Designer and explorer actions using one compatible-URI predicate and the same document tab. |
| [#1669](https://github.com/wieslawsoltes/SharpForge/issues/1669) | T01.9 recovery | Present | S snapshots modes, ratio, zoom, scroll and selection per URI; deferred recovery filters missing files and node IDs. Guide persistence is separately G7. |
| [#1670](https://github.com/wieslawsoltes/SharpForge/issues/1670) | T01.10 browser isolation | Gate | `browser_designer_documents_test.py` exercises side-by-side files, independent changes and recovery. Authorship/manifest registration is not a CI pass. |
| [#1671](https://github.com/wieslawsoltes/SharpForge/issues/1671) | T02.1 chrome tokens | Present | C centralizes dimensions/colours in designer chrome styles. The old release12/release13 monolithic stylesheets are absent in this assembled tree. |
| [#1672](https://github.com/wieslawsoltes/SharpForge/issues/1672) | T02.2 command component | Present | C uses Studio SVG icons, accessible names and flex alignment for command buttons. Geometry thresholds still require execution. |
| [#1673](https://github.com/wieslawsoltes/SharpForge/issues/1673) | T02.3 overflow bar | Present | C composes document mode controls, commands and sync with an accessible overflow menu and density handling. Width-matrix qualification is pending. |
| [#1674](https://github.com/wieslawsoltes/SharpForge/issues/1674) | T02.4 geometry harness | Gap | C has the executable matrix and A18 manifest entry; G9 concerns the explicitly requested npm command route. |
| [#1675](https://github.com/wieslawsoltes/SharpForge/issues/1675) | T02.5 focus states | Gate | C supplies shared focus/hover/disabled tokens. At-least-3:1 visible focus for all interactive controls requires the final rendered check. |

## Source ownership and synchronization subtasks

| Issue | Scope | Status | Concrete coverage and remaining condition |
| --- | --- | --- | --- |
| [#1676](https://github.com/wieslawsoltes/SharpForge/issues/1676) | T03.1 partial symbols | Present | R discovers construction methods and bound fields/references across partial files; field-in-one-file/construction-in-another fixtures exist. |
| [#1677](https://github.com/wieslawsoltes/SharpForge/issues/1677) | T03.2 ownership model | Present | R classifies construction statements once and exposes serializable spans, node ownership and edit capabilities. |
| [#1678](https://github.com/wieslawsoltes/SharpForge/issues/1678) | T03.3 initializers | Restricted | R reads initializers, Add edges and attached setters with original-form literal writes. Anonymous inline structural moves are refused; some collection forms remain compiler-profile exclusions. |
| [#1679](https://github.com/wieslawsoltes/SharpForge/issues/1679) | T03.4 event symbols | Present | R/P expose methods, protected lambdas and multiple subscriptions; Events controls enforce edit/navigation capability and show reasons. |
| [#1680](https://github.com/wieslawsoltes/SharpForge/issues/1680) | T03.5 literal edits | Present | R/Q retain comments, line endings, numeric style and string kind; scalar token/diff budgets are pinned. |
| [#1681](https://github.com/wieslawsoltes/SharpForge/issues/1681) | T03.6 identity | Present | R remaps bound controls after rename/statement edits and preserves stable IDs; source, selection and runtime identity fixtures exist. |
| [#1682](https://github.com/wieslawsoltes/SharpForge/issues/1682) | T04.1 worker analysis | Gap | X runs candidate analysis off the main thread; G8 concerns actual request cancellation. The 3,000-line input latency threshold is separately unmeasured here. |
| [#1683](https://github.com/wieslawsoltes/SharpForge/issues/1683) | T04.2 last-valid preview | Present | X retains the valid document on source errors and publishes blocking diagnostics/overlay; recovery follows the debounce read path. |
| [#1684](https://github.com/wieslawsoltes/SharpForge/issues/1684) | T04.3 conflict protocol | Gap | X tests interleavings, source versions, design revisions and generations. G1 concerns which document becomes the accepted synchronized baseline. |
| [#1685](https://github.com/wieslawsoltes/SharpForge/issues/1685) | T04.4 shared history | Present | X records complete multi-file source transactions and before/after design analyses, intercepting editor undo boundaries and rejecting conflicting partial undo. |
| [#1686](https://github.com/wieslawsoltes/SharpForge/issues/1686) | T04.5 external changes | Present | X invalidates changed/missing source sets, checks workspace identity and retains staged/source versions in conflict. |
| [#1687](https://github.com/wieslawsoltes/SharpForge/issues/1687) | T05.1 insertion | Present | R inserts declarations, properties and correct Add edges, with local/field/var naming conventions and compile-gated candidate plans. |
| [#1688](https://github.com/wieslawsoltes/SharpForge/issues/1688) | T05.2 deletion | Present | R removes dependent owned statements and reports bound handwritten references; protected dynamic properties/events block deletion. |
| [#1689](https://github.com/wieslawsoltes/SharpForge/issues/1689) | T05.3 reparent/order | Gap | R moves Add edges with a retained subsequence and clears obsolete attached setters. G1 leaves the Studio accepted document inconsistent with that normalization. |
| [#1690](https://github.com/wieslawsoltes/SharpForge/issues/1690) | T05.4 Name rename | Present | R uses compiler-bound rename locations across partial fields/handlers, with collision/refusal diagnostics and identity hints. |
| [#1691](https://github.com/wieslawsoltes/SharpForge/issues/1691) | T05.5 handler gesture | Gap | R/X implement correct handler plans, subscriptions and navigation. G2 identifies the missing normal UI gestures. |
| [#1692](https://github.com/wieslawsoltes/SharpForge/issues/1692) | T05.6 cross-document paste | Present | R/P copy graph/resource closures, deduplicate IDs/names/keys and compile supported styled-control insertion. Rich target restrictions remain explicit. |
| [#1693](https://github.com/wieslawsoltes/SharpForge/issues/1693) | T05.7 generated formatting | Present | R detects indentation, line endings and declaration style; qualified names avoid unresolved new usings. Existing source bytes outside edits are retained. |

## Visual editing and layout subtasks

| Issue | Scope | Status | Concrete coverage and remaining condition |
| --- | --- | --- | --- |
| [#1694](https://github.com/wieslawsoltes/SharpForge/issues/1694) | T06.1 snaplines | Present | V computes edges, centres, baselines, spacing and parent guides with tolerance and Alt-disable; baseline propagation reaches actual measured elements. |
| [#1695](https://github.com/wieslawsoltes/SharpForge/issues/1695) | T06.2 arrangement | Present | V has six alignments, horizontal/vertical distribution and same-size variants, primary-selection semantics and single-transaction tests. |
| [#1696](https://github.com/wieslawsoltes/SharpForge/issues/1696) | T06.3 coordinate spaces | Present | V carries transforms, scroll offsets and local matrices through resize/drag; tests include a rotated/scaled parent at 200%. |
| [#1697](https://github.com/wieslawsoltes/SharpForge/issues/1697) | T06.4 margin anchors | Gap | V toggles alignment/stretch and preserves current bounds. G3 is the missing margin drag path. |
| [#1698](https://github.com/wieslawsoltes/SharpForge/issues/1698) | T06.5 keyboard transforms | Gap | V supports multi-selection nudge, Shift snap step and Ctrl resize. G4 concerns coalescing repeated order commands. |
| [#1699](https://github.com/wieslawsoltes/SharpForge/issues/1699) | T06.6 exact pointer undo | Present | V keeps gesture preview outside the document, commits once, and cancels without mutation; 200-event/exact-undo cases exist. |
| [#1700](https://github.com/wieslawsoltes/SharpForge/issues/1700) | T07.1 Grid rails | Present | V adds/removes/splits/reorders tracks, reindexes child starts/spans and refuses discontiguous reordered spans. R writes supported definitions. |
| [#1701](https://github.com/wieslawsoltes/SharpForge/issues/1701) | T07.2 Grid units | Present | V edits Auto/Star/Pixel values and maintains adjacent Star weight; actual matching host geometry remains a browser gate. |
| [#1702](https://github.com/wieslawsoltes/SharpForge/issues/1702) | T07.3 insertion bars | Present | V computes insertion indices in both orientations and wrap layouts, reused by Toolbox drops and layout reordering. |
| [#1703](https://github.com/wieslawsoltes/SharpForge/issues/1703) | T07.4 preview environment | Present | V separates device size, scale, theme, contrast and RTL from source serialization; tests preserve the original document/history. |
| [#1704](https://github.com/wieslawsoltes/SharpForge/issues/1704) | T07.5 adaptive states | Restricted | V records ranges/overrides and emits real managed `ApplyAdaptive(width)` plus baseline resets. Hosts must invoke it on resize; `SFD_RESPONSIVE_HOST_RESIZE` states that limitation. |
| [#1705](https://github.com/wieslawsoltes/SharpForge/issues/1705) | T07.6 geometry references | Gate | `runDesignerLayoutReferences()` compares actual source/CIL VM scenes and designer scenes through WinUIHost DOM for five layouts at 0.5px. Invoke it in the final gate; it is not native WinUI. |

## Property and resource subtasks

| Issue | Scope | Status | Concrete coverage and remaining condition |
| --- | --- | --- | --- |
| [#1706](https://github.com/wieslawsoltes/SharpForge/issues/1706) | T08.1 editor registry | Present | P selects factories by typed schema/name, isolates throwing custom factories and preserves other rows with inline diagnostics. |
| [#1707](https://github.com/wieslawsoltes/SharpForge/issues/1707) | T08.2 brushes | Restricted | P has solid/RGBA/HSV, optional EyeDropper, gradients and resource choice. Closed gradient source decoding/export exists; current SharpForge compilation cannot execute/apply the richer API. |
| [#1708](https://github.com/wieslawsoltes/SharpForge/issues/1708) | T08.3 compound values | Present | P offers linked fields, uniform constructors, draft scrubbing, GridLength kinds and blank mixed values with validation. |
| [#1709](https://github.com/wieslawsoltes/SharpForge/issues/1709) | T08.4 enum/font/numeric | Present | P supplies enum/flags controls, font sample/weight selection and constraint-aware scrub transactions; invalid values remain diagnostics. |
| [#1710](https://github.com/wieslawsoltes/SharpForge/issues/1710) | T08.5 source markers | Present | P distinguishes local/style/template/resource/binding/default, exposes reset/resource/binding/source actions, and reveals inherited values after local reset. |
| [#1711](https://github.com/wieslawsoltes/SharpForge/issues/1711) | T08.6 Events | Present | P filters compatible method signatures and provides New/Go controls with source-capability guards. Double-click creation is separately G2. |
| [#1712](https://github.com/wieslawsoltes/SharpForge/issues/1712) | T08.7 property search | Present | P searches names/values, sorts by category/name/source, persists arrangement/collapse state, and supports row keyboard navigation. |
| [#1713](https://github.com/wieslawsoltes/SharpForge/issues/1713) | T08.8 collections | Present | P provides an isolated Items/track draft with add/remove/reorder and nested scalar object fields. R writes ordered Items Add statements; style setters use the resource editor. |
| [#1714](https://github.com/wieslawsoltes/SharpForge/issues/1714) | T08.9 binding/reference | Restricted | P preserves structured path/mode/converter and resource expressions, reopens dialogs and does not evaluate them. Ordinary C# source plans refuse changed bindings/references until the runtime/source contract exists. |
| [#1715](https://github.com/wieslawsoltes/SharpForge/issues/1715) | T09.1 style commands | Present | P creates/applies/copies styles and moves chosen locals into validated target setters; R handles supported owned Style/BasedOn construction. |
| [#1716](https://github.com/wieslawsoltes/SharpForge/issues/1716) | T09.2 template scope | Present | P isolates a template DesignDocument, provides owner breadcrumb/commit/cancel, and rebuilds instance trees without shared visual objects. |
| [#1717](https://github.com/wieslawsoltes/SharpForge/issues/1717) | T09.3 visual states | Restricted | P records state setters and provides actual timed preview transitions. Current SharpForge source application rejects unsupported state APIs; explicit WinUI export remains uncompiled here. |
| [#1718](https://github.com/wieslawsoltes/SharpForge/issues/1718) | T09.4 resource documents | Restricted | P analyzes bounded generated XamlReader resource classes, stages key/reference edits and preserves unrelated C#; unowned external references refuse rename. Gallery corrections were assigned. Native compile acceptance is unavailable, and source write stays blocked. |
| [#1719](https://github.com/wieslawsoltes/SharpForge/issues/1719) | T09.5 instance strip | Present | P builds five states for each light/dark theme from cloned projections, with independent hosts and disposal; the source document is not mutated. |

## Live, accessibility and qualification subtasks

| Issue | Scope | Status | Concrete coverage and remaining condition |
| --- | --- | --- | --- |
| [#1720](https://github.com/wieslawsoltes/SharpForge/issues/1720) | T10.1 attachment picker | Present | L lists eligible app sessions/windows with project/session identity and independent request channels. Two-app browser execution remains pending. |
| [#1721](https://github.com/wieslawsoltes/SharpForge/issues/1721) | T10.2 generation identity | Present | L validates explicit session/generation/scene identity and rejects restarted targets; tests check no cross-session fallback. |
| [#1722](https://github.com/wieslawsoltes/SharpForge/issues/1722) | T10.3 live selection | Present | L routes surface/tree selection through the target session and guards generation; real concurrent-app round trips remain a gate. |
| [#1723](https://github.com/wieslawsoltes/SharpForge/issues/1723) | T10.4 source/hot reload | Pending | L/X bridge source ownership, guarded source write and target-specific reload. Assigned source receipts and live delta preflight must be integrated before paused-window acceptance. |
| [#1724](https://github.com/wieslawsoltes/SharpForge/issues/1724) | T11.1 keyboard page | Gate | A/C/V implement tab/child/parent navigation, Insert Toolbox and move/resize/order paths. The full Grid/TextBox/Button workflow must be exercised without a pointer. |
| [#1725](https://github.com/wieslawsoltes/SharpForge/issues/1725) | T11.2 announcements | Present | A queues bounded ordered selection/geometry/sync announcements and labels controls/adorners. A deterministic sink transcript is not an actual screen-reader session. |
| [#1726](https://github.com/wieslawsoltes/SharpForge/issues/1726) | T11.3 Error List | Present | A/X map stable SFD codes, source spans and fix hints into the shared Error List, retaining actual compiler severity. |
| [#1727](https://github.com/wieslawsoltes/SharpForge/issues/1727) | T11.4 accessibility check | Present | A checks names, contrast, tab order and target size, selects findings and reruns after edits. It is a bounded designed-UI checker, not a complete platform accessibility audit. |
| [#1728](https://github.com/wieslawsoltes/SharpForge/issues/1728) | T12.1 corpus | Present | Q has 51 golden fixtures: 49 accepted analyses and two explicit refusals, covering code-first/partial/generated/styles/templates/events/factories. |
| [#1729](https://github.com/wieslawsoltes/SharpForge/issues/1729) | T12.2 byte/diff budgets | Present | Q asserts no-op byte identity, preserved surrounding bytes, original line endings and declared one-file/scalar token budgets. |
| [#1730](https://github.com/wieslawsoltes/SharpForge/issues/1730) | T12.3 seeded sequences | Present | Q runs 1,000 deterministic insert/move/delete/property sequences, actual compilation, independent source reread and both managed VMs; failing seeds are replayable. |
| [#1731](https://github.com/wieslawsoltes/SharpForge/issues/1731) | T12.4 identity report | Present | Q deterministically records ownership, unsupported constructs and source/design/runtime identity; the report consistency test rejects unreviewed changes. The report lives beside its runnable generator. |

## Qualification and closure boundaries

The prior T12 evidence records **81 passing tests with no skips** at code revision
`e328f265395f4d8b9ecd2d20252222d0bab0614e`; `9eaefeaa1e86c9a1831f739d0880ae1904e706e8`
adds the evidence and documentation. It executes 44 supported fixtures on real source and CIL VMs and explicitly excludes unsupported cases.
Those numbers do not qualify later compiler, source-reader, host, or metadata changes. The final integrated corpus/report must be rerun
without weakening a golden simply because behavior changed.

The following must remain explicit in the completed-scope report:

- Native WinUI compilation/rendering was not available. Generated native source, a DOM scene, or an inspector fixture is not a native pass.
- Binding, gradient, ResourceDictionary and VisualState authoring is richer than the current SharpForge execution contract.
  `SFD1872`, `SFSYNC_OWNERSHIP` and `SFD1884` keep unsupported writes visible and preserve source.
- Inherited component previews retain SF1014/SF2200 compiler errors and read-only status. A preview wrapper is not a successful original-source compilation.
- Automatic native viewport triggers are not implemented by `ApplyAdaptive(width)`; its host callback requirement must be stated.
- Pure geometry/index timings do not establish the 5,000-node browser frame budget. The 3,000-line input-latency and probe sub-5ms criteria need their own measurements.
- The source/CIL WinUIHost geometry comparison, document isolation, chrome matrix, keyboard workflow, images/resources and concurrent apps need final integrated browser evidence.
- The package README still states a 1,000-control limit while newer scope documentation describes larger trees. Reconcile the public capability inventory with the actual validated profile.

The ordinary required PR check and the explicitly scheduled full matrix have different purposes. Follow the repository's serial
validation wrapper/schedule at the final slot, bind artifacts to the exact committed tree, and report unsupported targets separately.
This document does not satisfy prerequisite readiness, authoritative ownership locks, Project 15 routing, or the `agent/<task>` claim protocol.
Those publication conditions require the independent planning/remote audit. Each actual stacked PR must describe its real dependency base;
use merge commits to synchronize the stack, and use `Closes` only when that issue's complete acceptance is met and evidenced.
