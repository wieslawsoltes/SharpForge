# A15 resource/template implementation and acceptance inventory

This inventory links the assigned Project 14 leaves to concrete implementation
and fixtures. Test paths identify authored checks. Passing status comes from the
centralized completed-scope qualification report; this file does not close issues
or substitute fixture presence for an execution result. Broader A16/A17 and
browser checks are coordinated by their owners.

Implementation paths below are relative to
`packages/winui-properties/src/`, unless another package is named. Public API,
security policy, budgets and supported-platform limits are documented in
[a15-resources-templates.md](a15-resources-templates.md).

## T06: resources and themes

| Issue / work ID | Implemented acceptance behavior | Principal implementation | Authored evidence |
|---|---|---|---|
| #1791 / T06.1 | Nearest element/ancestor/application dictionary lookup and missing-key diagnostic | `resources/resource-dictionary.js`, `resource-scope.js` | `tests/a15-resources.test.js` nearest-scope lookup |
| #1792 / T06.2 | Reverse merged precedence; cycles rejected before publication | `resources/resource-dictionary.js` | `tests/a15-resources.test.js` cycle, entry-limit and precedence cases |
| #1793 / T06.3 | ThemeResource follows subtree theme; StaticResource retains its captured value | `resources/resource-scope.js`, `reference.js` | `tests/a15-resources.test.js` static/theme and invalid consumer mutation |
| #1794 / T06.4 | Pinned Fluent Light color/brush inventory | `resources/fluent-light.js`, `fluent-inventory.json` | `tests/a15-resources.test.js` enumerates all 184 upstream keys |
| #1795 / T06.5 | Matching Dark inventory and declared values | `resources/fluent-dark.js` | Same pinned-inventory fixture with Dark snapshots |
| #1796 / T06.6 | HighContrast semantic system colors and live host forced-colors input | `resources/fluent-high-contrast.js`, `fluent-resources.js`; root environment adapter | `tests/a15-resources.test.js` system-color/media-query cases; root host environment qualification |
| #1797 / T06.7 | Live accent consumers, explicit seven-color system ramp and deterministic browser fallback | `resources/accent-color.js`, `fluent-resources.js` | `tests/a15-resources.test.js` accent invalidation/ramp fixture; native Windows ramp parity applies only to supplied system values |
| #1798 / T06.8 | Effective theme events, nested requested-theme inheritance, host data-theme synchronization | `resources/resource-scope.js`, `fluent-resources.js` | `tests/a15-resources.test.js` scope and host lifecycle assertions |

## T07: typed styles

| Issue / work ID | Implemented acceptance behavior | Principal implementation | Authored evidence |
|---|---|---|---|
| #1799 / T07.1 | Typed TargetType and assignability diagnostics | `styles/style.js`, `object-model/style-resource-adapters.js` | `tests/a15-resources-styles.test.js`; managed property bridge fixtures |
| #1800 / T07.2 | Transitive sealing and incremental application | `styles/style.js`, `style-application.js` | `tests/a15-resources-styles.test.js` sealed base reuse and mutation rejection |
| #1801 / T07.3 | Implicit type-key style lookup; explicit style/null precedence | `styles/style-application.js`, `object-model/resource-services.js` | `tests/a15-resources-styles.test.js` implicit consumer invalidation and opt-out |
| #1802 / T07.4 | Named Setter.Target plus resource/binding setters | `styles/setter-plan.js`, `object-model/style-resource-adapters.js` | `tests/a15-resources-styles.test.js` namescope/static/dynamic cases; binding bridge fixtures |
| #1803 / T07.5 | Validate-before-commit and touched-record rollback without whole-heap snapshots | `styles/setter-plan.js`, `style-application.js`; runtime `ui/style-transaction.js` | `tests/a15-style-transaction-budget.test.js` exact 1,000-control counter and invalid-setter rollback on both VM engines |

## T08: template factories and presentation

| Issue / work ID | Implemented acceptance behavior | Principal implementation | Authored evidence |
|---|---|---|---|
| #1804 / T08.1 | Fresh ControlTemplate/DataTemplate instances and large tree bounds | `templates/template-factory.js` | `tests/a15-templates-managed.test.js` two 1,200-part LoadContent trees; `a15-templates-lifecycle.test.js` factory sharing rejection |
| #1805 / T08.2 | Indexed per-instance namescopes and nested boundaries | `templates/name-scope.js`, `template-factory.js` | `tests/a15-templates-lifecycle.test.js` fresh scopes, duplicate names, deferred reservations and rewind |
| #1806 / T08.3 | OnApplyTemplate override dispatch and GetTemplateChild with old lifetime cleanup | `templates/template-host.js`, `object-model/resource-services.js`; compiler UI profile | `tests/a15-object-model-compiler.test.js`; `a15-templates-lifecycle.test.js`; `a15-template-gc.test.js` |
| #1807 / T08.4 | Text presentation/inherited foreground and one-parent UI content | `templates/content-presenter.js`, `object-model/content-presentation.js` | `tests/a15-templates-managed.test.js`; `a15-templates-lifecycle.test.js`; `project14-content-collections.test.js` |
| #1808 / T08.5 | DataTemplate data context, selectors and live replacement | Same presentation models and `object-model/selector-model.js` | `tests/a15-templates-lifecycle.test.js`; `a15-templates-managed.test.js` Alpha/Beta replacement and old-label collection |
| #1809 / T08.6 | One routed Click through template part with owner sender and part OriginalSource | A15 tree/handler models plus A16 routed-event engine and root callback bridge | `tests/browser_a16_controls_test.py`, `tests/helpers/a16-browser-harness.js`, `a16-regression-scenes.js`; browser execution is a separate gate |

## T09: items and collection views

| Issue / work ID | Implemented acceptance behavior | Principal implementation | Authored evidence |
|---|---|---|---|
| #1810 / T09.1 | Items/ItemsSource exclusivity, observable and actual managed IList sources, ItemTemplate and ItemsPanel | `items/items-source.js`, `context-adapter.js`, `panel-template.js`; binding managed-list projection | `tests/a15-items-lifecycle.test.js`, `a15-items-group-presentation.test.js`, `a15-property-managed-lists.test.js` |
| #1811 / T09.2 | Container lookup identity through insert/remove/move and cleared item references | `items/container-generator.js`, `item-identities.js` | `tests/a15-items-lifecycle.test.js` duplicate occurrences, mutation lookup and cleanup |
| #1812 / T09.3 | Alternating StyleSelector with preserved local container values | `items/container-generator.js`, `context-adapter.js`; shared StyleApplication | `tests/a15-items-selector.test.js` same container across even/odd styles and local-value clearing |
| #1813 / T09.4 | Recycling/phase cancellation and no stale item binding updates | `items/container-generator.js`, `templates/content-presenter.js` | `tests/a15-items-recycling-stress.test.js` 10,000 reuses and constant listener count; phase lifetime tests |
| #1814 / T09.5 | Group headers, grouping mutations and current-item navigation | `items/collection-view.js`, `group-headers.js`, `object-model/view-resource-adapters.js` | `tests/a15-items-lifecycle.test.js`, `a15-items-group-presentation.test.js`; control-family master/detail integration |

## T10: visual states

| Issue / work ID | Implemented acceptance behavior | Principal implementation | Authored evidence |
|---|---|---|---|
| #1815 / T10.1 | Group/current-state models, unknown state false and event order | `visual-states/visual-state.js`, `visual-state-manager.js` | `tests/a15-visual-state-lifecycle.test.js` previous/current event ordering and unknown state |
| #1816 / T10.2 | State-layer setters restore styles and preserve local values | `visual-states/visual-state-manager.js`; shared setter plans | `tests/a15-visual-state-lifecycle.test.js` lower-source restore and local precedence |
| #1817 / T10.3 | One active transition with cancellation and stale completion rejection | `visual-states/animation-adapter.js`, `visual-state-manager.js`; animation clock | `tests/a15-visual-state-lifecycle.test.js` rapid transitions and snapshot-capable clock adapter |
| #1818 / T10.4 | Adaptive size changes and deterministic trigger ties | `visual-states/state-trigger.js`, `visual-state-manager.js` | `tests/a15-visual-state-lifecycle.test.js` adaptive/custom priority and repeated size behavior |
| #1819 / T10.5 | Host input drives CommonStates, FocusStates and CheckStates on the managed owner | `visual-states/visual-state-manager.js`; root/family host input bridge | `tests/browser_a16_controls_test.py` native input/CurrentState qualification coordinated with A16 |
| #1820 / T10.6 | Managed StateTriggerBase subclass calls SetActive; disposal removes evaluation listener | `visual-states/state-trigger.js`, `object-model/visual-state-resource-adapters.js`; compiler subclass profile | `tests/a15-managed-state-trigger.test.js` both runtime engines; portable trigger disposal fixture |

## T11: XAML

| Issue / work ID | Implemented acceptance behavior | Principal implementation | Authored evidence |
|---|---|---|---|
| #1821 / T11.1 | Written closed loading policy and pre-construction hostile input rejection | `xaml/schema.js`, `framework-schema.js`; policy document | `tests/a15-xaml-security.test.js` deterministic 64-type corpus, deferred unknown types, DTD/entity/depth/cancellation |
| #1822 / T11.2 | Namespace-aware XML with spans and no DTD/entity expansion | `xaml/xml-reader.js`, `diagnostics.js` | `tests/a15-xaml-security.test.js` namespace/entity/character/source-position and independent budget cases |
| #1823 / T11.3 | Registered properties, attached/content elements and real Grid/StackPanel/Button construction | `xaml/object-writer.js`, `deferred-writer.js` | `tests/a15-xaml-roundtrip.test.js`; `a15-templates-managed.test.js`; `a15-resource-exact-acceptance.test.js` compares complete XAML/code-first scenes on all four managed execution paths |
| #1824 / T11.4 | Shared documented literal conversions and materialization hooks | `xaml/type-converters.js`, `known-colors.js`, `literal-writer.js` | `tests/a15-xaml-converters.test.js`, `tests/fixtures/a15-xaml-literals.js`; 80+ reference conversions and negative bounds |
| #1825 / T11.5 | Nested markup-extension grammar and closed extension lookup | `xaml/markup-extensions.js`; binding token compiler | `tests/a15-xaml-roundtrip.test.js`, `a15-property-expression-compiler.test.js`, `a15-property-compiled-schema.test.js` |
| #1826 / T11.6 | XamlReader live managed controls and typed positioned failures | `object-model/xaml-resource-adapters.js`; root typed exception hooks | `tests/a15-templates-managed.test.js` live Button and typed catch on both runtime engines |
| #1827 / T11.7 | Deferred dictionaries/styles/templates, lexical static references and fresh uses | `xaml/resource-builders.js`, `deferred-writer.js`; template/resource models | `tests/a15-xaml-roundtrip.test.js`; `a15-resources.test.js`; compiled load/unload fixtures |
| #1828 / T11.8 | Structural canonical serialization including edited null and deferred syntax | `xaml/xaml-writer.js`, `literal-writer.js` | `tests/a15-xaml-roundtrip.test.js`, `a15-xaml-prototype-regressions.test.js`; serializer returns a string and performs no code-first file rewrite |

## T12: retention and performance

| Issue / work ID | Implemented acceptance behavior | Principal implementation | Authored evidence / remaining gate |
|---|---|---|---|
| #1829 / T12.1 | Binding churn detaches old owners/sources/handlers | Property/binding workstream lifetimes and retention | `tests/a15-property-churn.test.js`, `a15-property-binding-rewind.test.js`, `a15-property-managed-binding.test.js` |
| #1830 / T12.2 | Repeated style/template replacement releases old template-owner graphs and temporary roots | Template/resource/style model retainedValues and disposal | `tests/a15-template-gc.test.js`: 500 controls, eight rounds, weak old-part handles, host-record/pin baselines |
| #1831 / T12.3 | Registered property/style/binding benchmarks, allocation reporting and baseline gate | `scripts/benchmarks/a15-property-system.mjs`, `a15-property-registry.json`, `a15-property-gate.mjs`; `planning/qualification/property-performance-budget.json` | `tests/a15-property-performance-budget.test.js`; actual before/after baseline and measurements remain a centralized gate |

## T13–T18 and shared compiler ABI support

| Issue / work ID | Implemented acceptance behavior | Principal implementation | Authored evidence / integration gate |
|---|---|---|---|
| #892 / T13 | Cooperative DispatcherQueue priority/FIFO/thread-access and shutdown | `object-model/dispatcher-queue.js`, `object-model-adapters.js`; runtime scheduler bridge | `tests/a15-resources-dispatcher.test.js`; `a15-resource-exact-acceptance.test.js` enqueues all three priorities from a delayed Task started by a worker and checks both worker/UI thread access |
| #893 / T14 | Typed routed-event registration and AddHandler/RemoveHandler, handled-events-too, stable order | `object-model/routed-event-registry.js`, `routed-handler-list.js`; A16 router | `tests/a15-resources-object-tree.test.js`, A16 input/browser suites and root event bridge |
| #894 / T15 | Real UI subclass/base/virtual metadata and framework sidecar identity | Compiler `codegen/semantic/ui-class-profile.js` plus runtime UI virtual dispatch | `tests/a15-object-model-compiler.test.js`, `a15-interface-events.test.js`; `a15-resource-exact-acceptance.test.js` constructs and parents `Derived : UserControl`, calls its actual template override and checks the closed framework registry |
| #895 / T16 | Distinct logical/visual template ancestry and VisualTreeHelper access | `object-model/object-tree.js`; root template/parent/scene adapters | `tests/a15-resources-object-tree.test.js`, `project14-content-collections.test.js` source/canonical/CIL/reassembled fixture |
| #896 / T17 | Loading/Loaded and layout size/lifecycle notifications | `object-model/object-tree.js`; A16 layout/viewport adapters | `tests/a15-resources-object-tree.test.js`; completed A16 managed layout qualification |
| #897 / T18 | Checked event sender/OriginalSource downcasts using real type ancestry | Compiler UI profile and runtime UI type/callback services | `tests/a15-object-model-compiler.test.js`, `a15-interface-events.test.js`; templated browser route fixture |
| Shared value ABI | Exact object boxing, nullable presence/value/defaults, Single/UInt32 conversions, by-reference framework arguments | Compiler UI conversion/by-reference lowering; CIL nullable metadata; runtime nullable helpers | `tests/a15-nullable-values.test.js`, `a15-nullable-numeric.test.js`, `a15-nullable-boundary.test.js`, `a15-object-model-compiler.test.js` |
| Shared metadata | Authoritative UI/BCL binding MemberRefs and marked delegate types | Compiler emitter UI metadata anchors and delegate emission | `tests/a15-nullable-boundary.test.js`, binding expression/managed fixtures and direct-CIL metadata qualification |

## Qualification handoff

The implementation branch did not execute tests while the full scope was being
implemented. The integration owner opened the consolidated A15 gate after the
scope checkpoint. The first run exposed shared assignability/export issues and
two XAML prototype/default-callback issues; subsequent fix commits preserve the
existing assertions and add focused regressions. Refer to the current
`artifacts/results/project14/a15-tests*.log` for actual results.

The exact dispatcher/UserControl/XAML-equivalence fixtures were authored together
after the issue-metadata audit. Their presence is not an execution result; they
join the next completed-scope integration gate.

The integration owner runs new files through `node scripts/limited.js`, serially
with the completed-scope gates. Browser behavior, Windows reference comparisons,
Rust/native/Wasm support and performance measurements must each be reported for
the engine or platform actually used. No unexecuted target or missing baseline
is counted as passing. The open PR stack should state remaining qualification
without `Closes` until that leaf's acceptance has passed.
