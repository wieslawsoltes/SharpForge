# A16 implementation and acceptance map

This file maps every A16 leaf in [Project 14](https://github.com/users/wieslawsoltes/projects/14)
to implementation and fixtures. It is a review and qualification record.
**Every A16 case passed in the combined completed-scope gate at `a41a1767`.**
That broader A15/A16/A17 and changed-VM gate recorded 1,320 passing and 18 failing
tests out of 1,338. The later retained-host compatibility repair passed all eight
focused checks. Cross-area repairs, exact-publication-tree core, browser and
native qualifications stay open; an issue-map row alone does not establish
acceptance or permission to close an issue.

The implementation uses one registered layout, input, control, and automation
model per application. Source execution, reloaded compiler output, direct CIL,
reassembled CIL, and browser JavaScript use explicit adapters. The full public
signature inventory and the supported behavioral profile are separate facts.
Unsupported platform capabilities and preserved ABI differences remain visible.

## Scope and evidence rules

| Epic | Included task scopes |
|---|---|
| #224 · E01 | T01–T04: renderer extraction, measure/arrange, Grid, virtualization, routed input. |
| #225 · E02 | T05–T12: control families, automation, environment, metadata and parity tracking. |
| #545 · E03 | T13–T22: panels, scrolling, templates, transforms and adaptive content. |
| #546 · E04 | T23–T35: buttons, text, typography, icons, images and platform controls. |
| #547 · E05 | T36–T40: application lifecycle, activation, transfer and localization. |
| #1735–#1739 | B01–B05: existing layout, border, shape and radio regressions. |

Fixture references below identify coverage; their execution status comes from
the recorded gates rather than from their presence in this map.
A native result must identify the pinned SDK, application fixture, operating
system, execution engine, renderer, input method and result artifact. A metadata
match, successful constructor, structural accessibility audit, synthetic event,
or passing pure model test cannot substitute for those facts.

The metadata source is the exact lock at
[`tests/conformance/oracle/WinUI/packages.lock.json`](../../tests/conformance/oracle/WinUI/packages.lock.json),
including Microsoft.WindowsAppSDK **1.8.260921001**. Target-specific metadata
selection and provenance rules are described in [parity/METADATA.md](parity/METADATA.md).
The importer, comparison matrix, deviation list and behavioral-result schema
preserve missing members in the denominator. The import committed at `bedd9f7f`
contains **22,026 native rows**. Its recorded comparison has **6,140 exact
signatures, 778 accessor projections, 1,142 signature mismatches and 13,966
missing rows**, with **zero behavior-qualified rows**. These are the recorded
metadata results, not a claim that the later FocusState addition or repair
commits have already regenerated the matrix. The generated report is
[`docs/winui-api.md`](../../docs/winui-api.md).

## Recorded gates

| Scope and source | Observed result | Run artifact |
|---|---|---|
| Complete A16 and shared Project 14/runtime/ABI cases, `d91e0817` | 373 tests: 339 passed, 34 failed, none skipped. The failure list remains visible while owners repair their scopes. | `artifacts/results/project14/a16-complete-scope-gate.log`, `a16-complete-scope-failures.json` |
| Layout/pointer and initial automation/focus repair batch | 34 tests: 32 passed, two focus-test failures. All six layout-core and both pointer-transport cases passed; the focus failures were repaired in the following batch. | `artifacts/results/project14/a16-controls-repair-gate.log` |
| Complete owned automation/focus repair batch, `06e1d90e` | 29/29 passed: source/reload/CIL peer behavior, standalone/base construction, immutable owners, typed FocusState and pointer/focus/Disabled visual states across all four managed engines. | `artifacts/results/project14/a16-automation-focus-repair.log` |
| Combined completed A15/A16/A17 scope and changed VM boundaries, `a41a1767` | 1,338 tests: 1,320 passed and 18 failed. Every A16 case passed; the remaining failures were in shared value-storage/runtime, composition and drawing-inventory work. | `artifacts/results/project14/complete-repaired-epics-gate.log` |
| Retained-host compatibility repair, `dcf67d6e` | 8/8 passed: bounded template identities, immutable owner/part objects, exhaustive cleanup despite independent disposer failures, visual eviction, transient composition and detached portal geometry. | `artifacts/results/project14/a16-host-scene-lifetime-repair.log` |
| Locked metadata import and comparison, `bedd9f7f` | 22,026 imported rows; 6,140 exact signatures; no behavioral qualification. Windows GUI behavior was not executed by the metadata extractor. | `artifacts/results/project14/a16-native-metadata-import.log`, `a16-api-matrix.log` |

The repair runs used `node scripts/limited.js node --test` and were serialized
after the full scope had been implemented and its first complete gate had run.
Their passing cases do not turn the original complete gate into a passing run.
Exact-tree `core` checks belong to each published stack; the browser/renderer,
native accessibility, hardware-input and performance matrix remains separate.

## Fixture key

Paths in this table are repository-relative. A scope may also use the shared
browser gallery, but gallery construction alone does not prove every operation.

| Key | Authored fixture files and purpose |
|---|---|
| L1 | `tests/a16-layout-core.test.js`, `a16-layout-command.test.js`, `a16-layout-managed.test.js`: core slots, dirty passes, public operations, custom overrides and managed engines. |
| L2 | `tests/a16-layout-panels.test.js`: Grid tracks/spans and Stack/Canvas/Relative/Wrap/Border/Viewbox geometry. |
| L3 | `tests/a16-layout-composition.test.js`, `a16-layout-portals.test.js`: affine world geometry, clipping, retained composition and detached roots. |
| L4 | `tests/a16-layout-scrolling.test.js`, `a16-scroll-runtime.test.js`, `a16-scroll-template-configuration.test.js`: views, options, anchors, frame sampling and browser-owned worker completion. |
| L5 | `tests/a16-annotated-scrollbar.test.js`, `a16-layout-templates.test.js`: controller state, overlap/cancellation, real presenter ownership, shared template generators and rollback. |
| V | `tests/a16-virtualization.test.js`: bounded million-item windows, size indexing, recycling, focus pinning, flow preparation and incremental cancellation. |
| I1 | `tests/a16-input.test.js`, `a16-input-transport.test.js`: ordered routes, pointer/capture/key/focus/tab/XY behavior and clone-safe typed payloads. |
| I2 | `tests/a16-input-inertia.test.js`, `a16-input-inertia-metadata.test.js`, `a16-input-visual-state.test.js`, `a16-input-state-contracts.test.js`: manipulation/inertia, native-state publication and readonly FocusState metadata. |
| I3 | `tests/a16-input-drag.test.js`, `a16-input-template-drag.test.js`: data, flags, template ancestry, file grants, session bounds and deferrals. |
| I4 | `tests/a16-host-event-requests.test.js`, `a16-routed-event-requests.test.js`, `a16-javascript-event-requests.test.js`, `a16-managed-event-requests.test.js`: acknowledged cancellation and ordered managed handlers. |
| I5 | `tests/a16-studio-event-requests.test.js`, `a16-ui-event-transactions.test.js`, `a16-context-completions.test.js`, `tests/project14-*.test.js`: Studio/worker protocol, disposal and runtime integration. |
| F1 | `tests/a16-family-text.test.js`, `a16-family-managed-input.test.js`, `a16-private-scene.test.js`: text state, editor changes, composition, validation and password isolation. |
| F2 | `tests/a16-family-selection.test.js`, `a16-family-sparse-items.test.js`: occurrence identity, selection, tree/group sources and sparse realization. |
| F3 | `tests/a16-family-navigation-commands.test.js`, `a16-family-pane.test.js`, `a16-family-overlay-lifetime.test.js`: navigation, pane geometry, windows and portal lifetimes. |
| F4 | `tests/a16-family-values.test.js`: number/range, date/time/calendar, color/rating and status models. |
| F5 | `tests/a16-family-command-scope.test.js`, `a16-family-event-requests.test.js`: commands, menu/overflow geometry, editing and asynchronous default-action decisions. |
| F6 | `tests/a16-family-default-templates.test.js`, `a16-family-typography-engines.test.js`: real named templates, inherited text formatting and source/CIL projections. |
| S | `tests/a16-services-lifecycle.test.js`, `a16-services-media.test.js`, `a16-services-resources-transfer.test.js`: app/activation, media, grants, transfer and localization. |
| A1 | `tests/a16-automation.test.js`, `a16-automation-inventory.test.js`: peer definitions, attached values, factories, events and structural rules. |
| A2 | `tests/a16-automation-managed.test.js`, `a16-automation-peer-construction.test.js`, `a16-automation-transport.test.js`: typed peers, Core overrides, shared managed models, immutable constructor ownership and bounded worker actions. |
| A3 | `tests/a16-automation-text.test.js`, `a16-automation-virtual.test.js`: UTF-16 ranges, real-geometry requirements and logical item peers. |
| E | `tests/a16-layout-environment.test.js`, `a16-environment-managed.test.js`: validated environment, independent scales, occlusion, touch and typed settings. |
| P | `tests/a16-family-parity.test.js`, `a16-metadata-selection.test.js`: reference selection, comparison, deviations and evidence-only parity status. |
| C | `tests/a16-collection-changes.test.js`, `tests/a16-host-scene-lifetime.test.js`, `tests/winui-contract-ids.test.js`: bounded host collections/template identities, complete removal cleanup and released contract stability. |
| B | `tests/browser_a16_controls_test.py`, `tests/a16_browser_managed.py`, `tests/a16_browser_environment.py`: the consolidated actual-browser scope described below. |

## E01: registered layout and input

Implementation paths in this section are beneath `packages/winui-controls/src/`
unless a different package is named.

| Leaf | Implemented contract and principal files | Fixtures |
|---|---|---|
| #1832 · T01.1 | `registry.js`, `host/retained-host.js`, `host/scene-lifetime.js`, `host/panel-renderers.js`: inherited renderer lookup, registered hooks, bounded template identities and retained family lifetime cleanup. | L1, I1, C, B |
| #1833 · T01.2 | `contracts/layout.js`, `contracts/layout-input.js`, `contracts/families.js`, `contracts/automation.js`: separate contributions, explicit IDs and additive members. | C, P, A1 |
| #1834 · T01.3 | `layout/layout-engine.js`: desired/render size, measure/arrange state, dirty ancestry and bounded repeated passes. | L1 |
| #1838 · T01.4 | `layout/framework-element-layout.js`: explicit/min/max size, margins, constraints and alignment slots. | L1, L2, B |
| #1839 · T01.5 | `layout/measure-provider.js`, `layout/text-format.js`, runtime `ui/layout-overrides.js`: real host text/intrinsic metrics and explicit absent-provider errors. | L1, F6, B |
| #1840 · T01.6 | `layout/dom-applier.js`, `host/root-ownership.js`: absolute computed boxes with native behavior elements retained. | L3, B |
| #1841 · T01.7 | `layout/custom-layout.js`, runtime `ui/layout-overrides.js`: registered custom panel callbacks and real managed virtual dispatch. | L1 |
| #1842 · T02.1 | `layout/grid-tracks.js`, `layout/grid.js`: pixel/Auto/star measurement and constrained track allocation. | L2 |
| #1843 · T02.2 | `layout/grid-span.js`: spans, Auto contributions and bounded redistribution. | L2 |
| #1844 · T02.3 | `layout/grid.js`, `layout/geometry.js`: spacing, insets and shared physical-edge rounding. | L2, E, B |
| #1845 · T02.4 | `layout/grid-tracks.js`, runtime `ui/layout-services.js`: definition limits, Actual dimensions and invalidation. | L1, L2 |
| #1846 · T03.1 | `virtualization/realization-window.js`, `size-index.js`: variable-size visible windows and stable anchors. | V, F2 |
| #1847 · T03.2 | `virtualization/recycle-pool.js`, `items-repeater.js`: keyed reuse, focused-container pinning and disposal. | V, F2 |
| #1848 · T03.3 | `virtualization/items-stack-panel.js`: shared stack virtual placement for ItemsStackPanel/VirtualizingStackPanel. | V, B |
| #1849 · T03.4 | `virtualization/items-wrap-grid.js`: bounded row/column windows and wrap geometry. | V, B |
| #1850 · T03.5 | `virtualization/items-repeater.js`, `layout-factory.js`, `lined-flow-layout.js`: Stack/UniformGrid/LinedFlow layout, cancellable flow preparation. | V, F2 |
| #1851 · T03.6 | `virtualization/incremental-loading.js`: one in-flight load, bounded requests, cancellation and collection update. | V, F2 |
| #1852 · T04.1 | `input/routed-events.js`, `pointer-events.js`, `transport.js`: route identity/order, Handled, pointer points and intermediate samples. | I1, I4, B |
| #1853 · T04.2 | `input/pointer-capture.js`: explicit per-pointer ownership, native capture, removal/cancel release and one loss notification. | I1, B |
| #1854 · T04.3 | `input/keyboard-events.js`: typed keys/modifiers, routed keyboard state and native-editor exclusions. | I1, B |
| #1855 · T04.4 | `input/focus-manager.js`, runtime `ui/layout-input-state.js`: shared focus owner, focus events and readonly state. | I1, I2, B |
| #1856 · T04.5 | `input/tab-navigation.js`, `focus-manager.js`: TabIndex, tab scopes, directional candidates and clipped/disabled exclusion. | I1, B |
| #1857 · T04.6 | `input/gestures.js`: bounded tap/double-tap/holding/right-tap state and cancellation. | I1 |
| #1858 · T04.7 | `input/manipulation.js`, `inertia.js`: translation/scale/rotation, completion and bounded analytic inertia. | I1, I2 |
| #1859 · T04.8 | `input/drag-*.js`, `drop-files.js`, runtime `ui/drag-services.js`: routed DataPackage/flags, acknowledgements and private granted files. | I3, I5, S, B |
| #1860 · T04.9 | `input/hit-test.js`, `layout/render-properties.js`: reverse painter order, inverse transforms and ancestor clips. | I1, L3 |

The runtime's `ui/layout-services.js`, `layout-scene.js`, `layout-feedback.js`
and `layout-scroll-services.js` provide synchronous, DOM-free Measure/Arrange,
typed sizes and cached browser feedback. Browser hosts apply bounded `layout`
commands. Public DesiredSize/RenderSize/scroll getters do not depend on a fake DOM.

## E02: control families

The family source and public adapter contracts are documented in
[FAMILIES.md](FAMILIES.md). Paths below are beneath the controls `src/` directory.

| Leaf | Implemented contract and principal source group | Fixtures |
|---|---|---|
| #1861 · T05.1 | `text/`: UTF-16 selection, caret, replacement, length and casing rules. | F1, A3, B |
| #1862 · T05.2 | `text/`: input/textarea switching preserves model, selection and focus. | F1, B |
| #1863 · T05.3 | `text/`: composition transaction start/update/end and editing cancellation. Native IME remains unqualified. | F1, I4 |
| #1864 · T05.4 | `text/`, `commands/`: undo/redo and granted clipboard editing commands. | F1, F5, S, B |
| #1865 · T05.5 | `text/`, host private-value channel: private PasswordBuffer, reveal and length-only public state. | F1, A3, B |
| #1866 · T05.6 | `text/`: shared RichTextDocument/selection/formatting and explicit bounded RTF subset. | F1, A3 |
| #1867 · T05.7 | `text/`: AutoSuggest reason values, active suggestion and query submission. | F1, B |
| #1868 · T05.8 | Text/bidi composition fixtures and explicit qualification record; native CJK/RTL sessions still required. | F1, F6 |
| #1869 · T06.1 | `items/`: occurrence-based selection, ranges/current item and source reconciliation. | F2, A3 |
| #1870 · T06.2 | `items/`: ListView uses shared generated containers and virtual row geometry. | F2, V, A3, B |
| #1871 · T06.3 | `items/`: GridView/GridViewItem use shared selection and wrap placement. | F2, V, B |
| #1872 · T06.4 | `items/`: ItemsView/ItemContainer honors explicit shared Layout objects. | F2, V, B |
| #1873 · T06.5 | `items/`: bounded hierarchical tree, expansion, check state and realized row identity. | F2, A3, B |
| #1875 · T06.6 | `items/`: ComboBox popup, templates, selection and editable model. | F2, F6, B |
| #1876 · T06.7 | `items/`: ListBox/FlipView/PipsPager selection and keyboard paging. | F2, B |
| #1877 · T06.8 | `items/` with shared A15 group headers: SemanticZoom and grouped source projection. | F2, V |
| #1878 · T06.9 | `items/`: SelectorBar/RadioButtons/BreadcrumbBar use authoritative selection models. | F2, B |
| #1879 · T07.1 | `navigation/`: cancellable Frame/Page history, parameter/cache and virtual callbacks. | F3 |
| #1880 · T07.2 | `navigation/`: adaptive pane/content geometry and hierarchical NavigationView. Top overflow difference remains recorded. | F3, F6, B |
| #1881 · T07.3 | `navigation/`: TabView selection/close/reorder and collection preservation. Worker native drag cancellation is limited. | F3, F2, B |
| #1882 · T07.4 | `overlay/`: one root portal, light dismissal, focus restoration and nested ownership. | F3, L3, B |
| #1883 · T07.5 | `overlay/`: Flyout placement, opening/closing and acknowledged cancellation. | F3, I4, B |
| #1884 · T07.6 | `overlay/`: ContentDialog result, buttons/deferrals, focus containment and concurrent-show rejection. | F3, I4, B |
| #1885 · T07.7 | `overlay/`: TeachingTip target/placement, icon/tail and close reasons. | F3, B |
| #1886 · T07.8 | `overlay/`, `commands/`: ToolTip descriptions, focus preservation, Escape and disposal. | F3, B |
| #1887 · T07.9 | `navigation/layout.js`: SplitView's shared overlay/inline/compact pane and content slots. | F3, F6, B |
| #1888 · T07.10 | `navigation/`: Pivot/PivotItem selection and locked navigation. | F3, B |
| #1889 · T07.11 | `app/`: logical Window activation, visibility, content and committed close lifetime. | S, F3, B |
| #1890 · T07.12 | `app/`: logical AppWindow geometry/titlebar/presenter policy; native presenters need adapters. | S, F3 |
| #1891 · T08.1 | `values/`: NumberBox parsing/formatting, validation, step and range. | F4, A2, B |
| #1892 · T08.2 | `values/`: DatePicker/Flyout parts and typed nullable date projection. | F4, F6, B |
| #1893 · T08.3 | `values/`: TimePicker/Flyout and nullable SelectedTime distinct from zero. | F4, F6, B |
| #1894 · T08.4 | `values/`: Gregorian CalendarView date bounds, selection and blackout state. | F4, B |
| #1895 · T08.5 | `values/`: CalendarDatePicker uses the real calendar popup and synchronizes open state. | F4, F3, B |
| #1896 · T08.6 | `values/`: RangeBase/Slider clamp, step, input and automation share one range. | F4, A2, B |
| #1897 · T08.7 | `values/`: ProgressBar/ProgressRing values and indeterminate state. | F4, B |
| #1898 · T08.8 | `values/`: InfoBar cancellation/severity and InfoBadge state. | F4, I4, B |
| #1899 · T08.9 | `values/`: RatingControl, RGB/HSV ColorPicker and ToggleSwitch. | F4, B |
| #1900 · T09.1 | `commands/`: ICommand CanExecute/Execute and native/managed/automation Button invocation. | F5, A2, B |
| #1901 · T09.2 | `commands/`: XamlUICommand/StandardUICommand defaults and live CanExecute. | F5 |
| #1902 · T09.3 | `commands/`: scoped accelerators and acknowledged Invoked.Handled before defaults. | F5, I4, B |
| #1903 · T09.4 | `commands/`: access-key scope, invocation and canceled defaults. | F5, B |
| #1904 · T09.5 | `commands/`: nested MenuFlyout traversal, hover, toggles/radio groups and dismissal. | F5, B |
| #1905 · T09.6 | `commands/menu-layout.js`: MenuBar Alt/F10 entry and cross-menu traversal. | F5, B |
| #1906 · T09.7 | `commands/layout.js`: CommandBar primary/overflow groups, DynamicOverflowOrder and AppBar elements. | F5, F6, B |
| #1907 · T09.8 | `commands/`: command/text flyout commands, readonly gating and injected clipboard. | F5, F1, B |
| #1908 · T09.9 | `commands/`: one ContextRequested decision path before context flyout defaults. | F5, I4, B |
| #1909 · T09.10 | `commands/`: SwipeControl actions and RefreshContainer deferral lifetime. | F5, I4, B |

## E02: automation, environment and inventory

| Leaf | Implemented contract and principal source group | Fixtures |
|---|---|---|
| #1910 · T10.1 | `automation/`: typed base peers, owner identity, custom Core virtuals and null-peer suppression. | A1, A2 |
| #1911 · T10.2 | `contracts/automation.js`, `automation/`: attached naming, help, labels, position and live settings. | A1, B |
| #1912 · T10.3 | `automation/`: native ARIA roles/attributes and explicit ownership of generated attributes. | A1, B |
| #1913 · T10.4 | `automation/`: Invoke/Toggle/Value/Range/Selection/ExpandCollapse/Scroll and bounded Text providers. | A1, A2, A3 |
| #1914 · T10.5 | `automation/`: distinct registered control peer definitions and authoritative family models. | A1, A2, B |
| #1915 · T10.6 | `automation/`: bounded/coalesced property notifications and non-focus-stealing live regions. | A1, A2, B |
| #1916 · T10.7 | `automation/`: GPU semantic proxies preserve focus, native editor semantics and logical item identity. | A1, A3, B |
| #1917 · T10.8 | Actual browser ARIA snapshots plus named structural/DOM rule engines. Native AT and cross-browser qualifications remain separate. | A1–A3, B |
| #1918 · T11.1 | `layout/dpi.js`, environment observer and shared rounding: independent DPR/XamlRoot feedback. | E, L2, B |
| #1919 · T11.2 | `layout/text-scale.js`, measurement and drawing: live text policy and per-element opt-out. | E, F6, B |
| #1920 · T11.3 | Environment/system-color palette, shared resource scope and rendering color policy. | E, B; A17 color-policy fixtures |
| #1921 · T11.4 | Environment animation preference and composition theme/implicit/connected cancellation; application clocks stay explicit. | E, L4, B; A17 transition fixtures |
| #1922 · T11.5 | Touch-effective 40-DIP targets, narrow layouts and explicit real InputPane capability. Native keyboard sessions remain unqualified. | E, F3, B |
| #1923 · T12.1 | `parity/import-inventory.js`: locked packages, hashes, exact target metadata and deterministic facts; the recorded import contains 22,026 rows. | P; recorded import above |
| #1924 · T12.2 | `parity/matrix.js`: type/member comparison against the complete imported denominator. | P |
| #1925 · T12.3 | `parity/deviations.json`: explicit released differences, unsupported capabilities and excluded profile extensions. | P |
| #1926 · T12.4 | `parity/gap-export.js`: behavioral status requires identified result evidence; gaps remain exportable. | P |
| #1927 · T12.5 | `parity/docs-generator.js`: documentation consumes the matrix rather than treating registry presence as parity. | P |

Internal generic semantic nodes preserve descendants when a layout element has
no public native peer. They do not change the public CreatePeerForElement result.
Logical virtual-item peers stay stable by occurrence key; unrealized rows report
empty bounds/offscreen. Password peers expose no Value or Text provider.

## E03: panels, scrolling and auxiliary templates

| Leaf | Implemented contract and principal source group | Fixtures |
|---|---|---|
| #898 · T13 | `layout/stackpanel.js`: main/cross-axis slots, spacing and physical-edge rounding. | L1, L2, B |
| #899 · T14 | `layout/canvas.js`, shared world traversal: attached placement and painter-order ZIndex. | L2, L3, B |
| #900 · T15 | `layout/relativepanel.js`: anchor constraints, dependencies and explicit cycle rejection. | L2 |
| #901 · T16 | `layout/wrapgrid.js`: shared wrap/variable-span slots and attached spans. | L2, V |
| #902 · T17 | `layout/border-viewbox.js`: border/padding insets, stretch transforms and actual content template roots. | L2, L3, F6, B |
| #903 · T18 | `layout/scrollviewer.js`, `scroll-host.js`: nullable ChangeView, clamping, input, anchors and immediate metric publication. | L4, B; A15 nullable numeric fixtures |
| #904 · T19 | `layout/scrollview.js`, `scroll-presenter.js`: real PART_ScrollPresenter, shared owner view, snaps and correlation completion. | L4, L5, F6, B |
| #905 · T20 | `layout/expander.js`, host renderer and family catalog: separate managed header/content parts and Up/Down arrangement. | L4, F6, B |
| #906 · T21 | `layout/render-properties.js`, `host/composition.js`: value/reference transforms, world clips and transient layout-neutral composition properties. | L3, I1; A17 rendering fixtures |
| #907 · T22 | `layout/twopaneview.js`, `parallaxview.js`, `annotated-*.js`, `template-services.js`: adaptive panels, dependent parallax, controller and real auxiliary templates. | L2, L4, L5, B |

Annotated LabelTemplate and DetailLabelTemplate use the existing shared
ItemContainerGenerator and ContentPresenterController. The application prepares
them before visual traversal and after acknowledged DetailLabelRequested.
`$layoutTemplates` contains visual identities only; `$itemContainers` and managed
owner edges retain at most 2,048 label containers plus one detail container.
Both transaction journals capture the owner model before mutation. Restore does
not replay factories, and disposal clears live and recycled template lifetimes.
Label.Content and ScrollOffset are getter-only constructor values; replace the
label in Labels. Mutable data inside Content uses ordinary template bindings.

## E04 and E05: display controls and application services

| Leaf | Implemented contract and principal source group | Fixtures |
|---|---|---|
| #908 · T23 | `buttons/`, `layout/button-layout.js`, default catalog: ClickMode/command/state and centered template content. | F5, F6, L2, B |
| #909 · T24 | `buttons/`: RepeatController, dropdown/split parts and independent toggle/split actions. | F5, B |
| #910 · T25 | `buttons/`: tri-state toggle/check and parent/XamlRoot/application radio scopes. | F5, B |
| #911 · T26 | `buttons/`, `text/`, `app/`: HyperlinkButton/Hyperlink navigation follows explicit launcher policy. | F5, S, B |
| #912 · T27 | `text/`, shared drawing text: real Inlines and inline visual ownership. | F6, B; A17 inline fixtures |
| #913 · T28 | `text/typography.js`, `text/contracts.js`: typed font companion/weights/style, inherited features and explicit font fallback. | F6 |
| #914 · T29 | `text/`: linked RichTextBlockOverflow distributes actual DOM Range content with bounded traversal. | F1, F6, B |
| #915 · T30 | `icons/`: symbol/font/path/bitmap elements and source materialization. | S, F6, B |
| #916 · T31 | `media/`: Bitmap/WriteableBitmap resource policy, real pixel buffers and image lifecycle. | S, B; A17 image fixtures |
| #917 · T32 | `media/`: PersonPicture state and AnimatedVisualPlayer fallback or explicit adapter. | S, B |
| #918 · T33 | `media/`: sandboxed iframe WebView2 navigation with origin policy and explicit native API errors. | S, B |
| #919 · T34 | `media/`: actual HTML media playback/pause/seek/transport and explicit unsupported sources. | S, B |
| #920 · T35 | `media/`: bounded InkCanvas strokes; Map/Capture construction requires registered platform capability. | S, B |
| #921 · T36 | `app/`: application/session lifecycle, per-application services and final disposal. | S, I5 |
| #922 · T37 | `app/`: Launch/HTTP(S) protocol activation and granted browser file activation; native kinds remain capability-gated. | S |
| #1732 · T38 | `app/`: browser visibility/suspend/resume mapping, deferrals and owner cancellation. | S, I4 |
| #1733 · T39 | `app/`: shared DataPackage, granted Clipboard and Launcher; private external files use separate drag capability. | S, I3, B |
| #1734 · T40 | `app/` with A15 resources: x:Uid/ResourceLoader/ResourceManager, language refresh and missing-key behavior. | S, F6 |

## Existing defects and template integration regressions

| Issue | Authored check |
|---|---|
| #1735 · B01 | 144 Button/ToggleButton/AppBarButton/HyperlinkButton height/font/content combinations, plus CSS zoom. Actual DOM Range bounds must remain vertically centered. |
| #1736 · B02 | Horizontal and vertical StackPanel cross-axis start/center/end/stretch slots are compared with actual browser boxes. |
| #1737 · B03 | Null/default BorderBrush retains the declared visible control border; an explicit brush changes the actual CSS color. |
| #1738 · B04 | Shapes participate in StackPanel and Grid slots and honor Canvas coordinates only in the Canvas case. A17 owns paint-backend reference images. |
| #1739 · B05 | Unnamed groups remain parent-scoped, named groups span one XamlRoot, and independent applications remain isolated. |
| #1809 · A15 integration | A native click on the managed template's inner Border raises Click once, sender=Button and OriginalSource=that Border. |
| #1819 · A15 integration | Native hover/press/release/disable/focus updates readonly state before callbacks and the actual managed VisualStateGroup.CurrentState. |

The managed template/input cases are authored in
`tests/helpers/a16-managed-browser.js` and invoked by `tests/a16_browser_managed.py`.
The raw regression scenes are in `tests/helpers/a16-regression-scenes.js`.

## Consolidated browser batch

`tests/browser_a16_controls_test.py` uses the existing Studio/CSP browser harness.
It runs one sequential full-scope batch and writes its result beneath the
repository browser results directory in `a16-controls/`. It records backend
availability and preserves failure screenshots and JSON; it does not quietly
promote an unavailable GPU or codec to a passing result.

| Browser fixture | Evidence collected when executed |
|---|---|
| Family gallery | Actual `aria_snapshot()` trees, named structural/DOM audit results, native Tab reachability, explicit platform-construction faults and password non-disclosure. DOM/Canvas2D trees are compared; WebGPU is included only when an adapter is available. |
| B01–B05 | Actual element boxes and DOM Range text geometry, renderer/slot regressions and independent radio roots. |
| Native keyboard/capture | Playwright keyboard and pointer actions, managed event sender/source, focus states, actual capture outside the element and one capture-loss notification. |
| Scroll/template/controller | Actual wheel/Ctrl-wheel, sampled animated offsets, final-event/completion order, public ScrollPresenter identity, cancelable annotated requests and real DataTemplate output. |
| Expander/rich overflow | Managed named header/content templates with native keyboard activation; actual DOM Range distribution across linked overflow containers. |
| Command helper | `tests/helpers/a16-family-command-browser.js`: DOM menus/F10/traversal, radio groups, command overflow, text commands and acknowledged ContextRequested. Keys in this helper are synthetic DOM events. |
| Overlay helper | `tests/helpers/a16-family-overlay-browser.js`: real tooltip description/focus, Escape, concurrent dialog rejection and acknowledged accelerator cancellation. Synthetic events do not qualify trusted OS input. |
| Media helper | `tests/helpers/a16-family-media-browser.js`: actual video/native controls and the local synthetic MP4. Playback/seek success is recorded separately from an unsupported H264 decoder. |
| Drag/file helper | Actual DataTransfer/File objects with synthetic DragEvents. Explicit denied/granted private-file adapters are checked. This is not an OS cross-application drag session. |
| Environment | Live text scaling independent of DPR, actual forced-color/reduced-motion media state, DPR contexts at 1/1.25/1.5/1.75/2/3/4, and narrow touch mode with a native browser tap. |

Pinch uses a bounded synthetic two-pointer stream. It checks the browser-host
gesture path but does not qualify a physical touchscreen or precision touchpad.
Clipboard tests inject an explicit grant and backend; they do not prove actual
browser permission prompts. InputPane absence is checked as an explicit empty
capability; no keyboard rectangle is inferred from viewport guesses.

## Qualifications and known differences that remain open

These are acceptance limits, not hidden passing substitutions. The machine-readable
profile differences are in [parity/deviations.json](parity/deviations.json).

| Area | Remaining qualification or explicit supported-profile boundary |
|---|---|
| Native oracle | Windows GUI behavior and assistive-technology captures are not produced by the metadata importer or these authored fixtures. Native issue acceptance remains open. |
| Released ABI | Orientation stays Vertical=0/Horizontal=1. Released event delegates and string Image/FontFamily/date/time signatures stay compatible; typed companions do not erase the mismatch. |
| Text/fonts/IME | Segoe UI Variable/Segoe UI/system-ui is an explicit fallback, not proven metric equivalence. Licensed-font, Windows CJK/RTL IME, bidi caret and accessibility sessions remain required. |
| Rich text | The bounded text/RTF formatting subset rejects embedded objects and unsupported control words. Browser overflow uses real DOM Range geometry, not a claim of native RichEdit fidelity. |
| Text scaling | The host policy is linear with a bounded extension range; Windows preference transfer and nonuniform native scaling are not claimed. |
| Automation | Browser DOM/proxy semantics are not a Windows UIA COM provider. Bounds are host-relative DIPs. Named structural audits are not axe-core or screen-reader results. |
| Worker text providers | Synchronous custom application text callbacks across a worker need an explicit text adapter. The built-in range subset requires real text geometry. |
| Pointer/manipulation | Browser monotonic timestamps and available pointer properties are used. Unavailable hardware scan/input-frame facts are not invented. Native inertia curves and physical touch hardware remain unqualified. |
| Drag | An outgoing OS drag must have data prepared before synchronous dragstart. Worker replies cannot revoke an OS drag already started. External files expose granted descriptors with no native Path or unrestricted file contents. |
| InputPane | Only real virtualKeyboard geometry or an explicit platform adapter reports occlusion. Absent capability returns empty/false. Worker notification cannot undo browser default scrolling already performed. |
| Scrolling | The defined cubic-out animation and UI-thread annotated controller are implemented. Native composition panning is absent (`PanningInfo=null`); custom controllers require an adapter. |
| Expander | Up/Down are implemented. Released Left/Right values fail explicitly. Collapse updates layout immediately; the browser opening animation does not establish native composition equivalence. |
| NavigationView | Top items scroll horizontally; native top-overflow dropdown behavior remains a recorded gap. |
| Calendar | Gregorian UTC arithmetic is implemented. Other calendar identifiers fail explicitly. |
| WebView2 | Sandboxed iframe navigation is the profile. Native CoreWebView2/process APIs and ExecuteScriptAsync are unavailable. Cross-origin error observation has browser limits. |
| Media/platform controls | Playback depends on actual codecs/autoplay policy. DRM/device capture/map/Lottie operations require explicit capabilities. Map/Capture reject absent adapters; AnimatedVisualPlayer can show FallbackContent. |
| Activation/windows | Launch and HTTP(S) protocol are intrinsic. Browser file activation requires a grant. Native multi-process redirection, presenter and OS window operations require adapters. |
| Browser lifecycle/permissions | Real clipboard grants, bfcache lifecycle, floating virtual keyboards and native suspend timing need separate platform runs. |
| Performance | The layout benchmark and million-item fixtures are authored. No frame-time, allocation, memory, speedup or leak-free claim is made before measured results. |
| Renderer matrix | Actual available browser/backend results must be recorded separately. A fallback or an unavailable hardware adapter is never silently counted as native GPU qualification. |

## Gate and publication handoff

The requested batching policy applies: implement and integrate the complete
scope, then validate it once through the scheduled serial gate. Do not start
independent heavyweight jobs per leaf or per worktree. Worktrees are synchronized
before the gate; draft stacked PRs record pending qualification explicitly.

The A16 manifest includes `tests/a16-*.test.js`, shared Project 14 integration
fixtures, released contract/runtime checks and the consolidated browser script.
The integrating owner runs the repository core check and build at the scheduled
slot, then the applicable A16 tests through the limiter. A direct targeted node
batch uses the existing command form:

```sh
node scripts/limited.js node --test tests/a16-*.test.js tests/project14-*.test.js
```

Run the browser script only with the normal Studio HTTP/CSP harness and browser
dependencies ready. Record the exact commit, command, engine/browser versions,
renderer/capability outcome and artifact path. Metadata import/matrix/document
generation follows [parity/METADATA.md](parity/METADATA.md); Windows native and
assistive-technology qualification follows the existing serial qualification plan.

The root integration wires shared default templates, layout, private passwords,
ordered routed handlers, control-state feedback, event acknowledgements,
automation, environment resources/composition and auxiliary template lifetimes.
The complete deliverable remains reviewable through these small contribution
seams. Broader qualifications that cannot run in the available environment stay
explicitly pending; they do not become completed issues because code was merged.
