# A15 property and binding acceptance inventory

This inventory covers the 28 assigned leaves in SF-A15-T01 through T05, the additional
SF-A15-T12.3 performance gate, and the shared compiler/runtime support for T13 through T18.
It records implementation and authored evidence separately from qualification. An authored
fixture does not mean that its affected platforms passed.

## Qualification state

Implementation includes portable services, framework contracts, managed source/CIL bridges,
JavaScript facade integration, diagnostics, examples, documentation and focused fixtures.
Execution started only after the complete assigned implementation was integrated. The
coordinator owns consolidated runs; individual repair probes address observed failures.

| Recorded source | Evidence | Result and limits |
| --- | --- | --- |
| `a41a1767e16761f6f28cff0a611b885b2209d08c` | `artifacts/results/project14/complete-repaired-epics-gate.log` | Complete A15/A16/A17 batch: 1,338 tests, 1,320 passed and 18 failed. This is an integrated source result, not qualification of each subsequently published stack head. |
| `037de2e23ad112745884deed0ec6adbe29e584a6` | `a05-compatibility-targets.log` in the shared workspace | All 13 selected A05 value/captured-cell compatibility failures passed after preserving user-owned type identity and typed value copies. The other five failures were assigned to their area owners. |
| `db841495b279ddc71ef920d852dfec1d86765b19` | Committed main synchronization, following `98f4d44e` | Main Project16 storage, generic Nullable, verified stack proofs and callback lifetime changes are integrated. The new nullable call/return, proof-union and callback quota/event cases remain unrun at this inventory update. |

The coordinator's next complete batch must cover the synchronized tree and focused
successors for heap import ownership, DefaultStyleKey invalidation and Studio binding
diagnostics. Static import and tree inspection of publication manifests does not count as
executing those paths. No passing result is inferred for an unrun publication tree.

The performance harness has not been measured. Its budget JSON deliberately contains
`baselineCommit: null`; the gate fails closed until the coordinator records a real baseline.
Do not close issues or describe browser/native/reference parity as passed from this map.

## Implementation groups

Paths below are relative to the repository root. The short group names keep the leaf map
readable without hiding integration dependencies.

| Group | Implementation |
| --- | --- |
| Registry | `packages/winui-properties/src/dependency-property.js`, `property/metadata.js`, `property/validation.js` |
| Store | `packages/winui-properties/src/property/property-store.js`, `property/store-snapshot.js`, `property/value-equality.js` |
| Hosts | Managed UI property adapters/object properties; `property/javascript-style-system.js`; JavaScript context/member facade |
| Attached | `packages/winui-properties/src/property/attached.js`, `contracts/property.js` |
| Notifications | `observable/change-queue.js`, `observable/observable-object.js`, `observable/subscription-lifetime.js` |
| Collections | `observable/observable-vector.js`, vector/list adapters and `contracts/property-lists.js` |
| Managed members | `packages/runtime/src/ui/member-access.js`, `binding-services.js`, `binding-events.js`, `binding-collections.js` |
| Binding | `packages/winui-properties/src/binding/binding-expression.js`, `binding-operations.js`, adapters/context services |
| Compiled | `packages/winui-properties/src/binding/compiled/`, runtime `ui/compiled-symbols.js` and `ui/compiled-xaml.js` |
| Resources | Shared styles/resources/templates, object writer, ItemsSource and visual-state services owned by the resources worktree |
| Animation | Composition/animation source-access services consume Store slots; owned jointly with the composition worktree |
| Scene | `property/change-emitter.js`, host rendering dependencies, JavaScript collections/events and shared scene journals |
| Perf | `scripts/benchmarks/a15-property-system.mjs`, registry/gate files and the checked-in property budget |

Where a shortened path appears after a package name, it is under that package's `src/`.
Source paths differ from some proposed issue filenames because the implementation groups
the same public contract into bounded, separately testable modules.

## Exact leaf map

All rows require completed consolidated qualification before `Closes #...` is appropriate.
The test key resolves to exact focused file names in the next section.

| Issue | Work ID suffix | Delivered behavior | Groups | Test keys |
| --- | --- | --- | --- | --- |
| #1761 | T01.1 | Shared declaring-owner DP identity and bounded default base assignability | Registry, Hosts | R, VB, MB |
| #1762 | T01.2 | User Register/RegisterAttached and identical static/accessor handles | Registry, Attached, Hosts | R, MB, OM |
| #1763 | T01.3 | Typed defaults, per-owner factories and effective-change metadata callbacks | Registry, Store, Hosts | S, V, SS, MB |
| #1764 | T01.4 | Shared scalar/enum/reference/struct/nullable validation and coercion | Registry, Store, Hosts | V, VB, MB, NV |
| #1765 | T01.5 | Attached owner lookup, typed storage, static identifier and local read/clear | Attached, Hosts | R, HC, MB |
| #1766 | T01.6 | Owner-scoped callback tokens, unregistration, retained delegate values and rewind | Store, Hosts | S, SS, MO |
| #1767 | T02.1 | All ordered sources, local Unset/null distinction and readonly host capability | Store, Hosts | S, HC, RD |
| #1768 | T02.2 | Animation slot with live current base on stop/clear | Store, Animation | S, A13 |
| #1769 | T02.3 | Logical-parent inheritance, overrides, reparenting and keyed text identity | Store, Attached, Hosts | S, HC, BB |
| #1770 | T02.4 | DefaultStyle below explicit/implicit application setters | Store, Resources | S, RS |
| #1771 | T02.5 | Effective-change-only property commands and indexed shared-value consumers | Store, Scene | VB, JC, RD |
| #1772 | T03.1 | Real source/CIL INPC members, empty-name invalidation and interface accessors | Managed members, Binding | B, MB, MO |
| #1775 | T03.2 | ObservableCollection and exact INCC item/index/action payloads | Collections, Managed members | O, VV, ML |
| #1776 | T03.3 | Loaded/Unloaded detach, target GC cleanup and weak managed source handles | Notifications, Binding, Hosts | O, OR, CH, MO, TG |
| #1777 | T03.4 | FIFO coalescing, reentrant budget and cycle diagnostics | Notifications, Store, Binding | O, OR, S, BB |
| #1778 | T03.5 | WinUI vectors/views, IList ancestry, real managed list projection and item mutations | Collections, Scene | VV, JC, ML |
| #1779 | T04.1 | Binding/BindingBase/Expression/Operations contracts and target validation | Binding, Hosts | B, BB, MB |
| #1780 | T04.2 | Bounded nested/index/key/attached paths and suffix resubscription | Binding, Managed members | B, BB, ML |
| #1781 | T04.3 | OneTime/OneWay/TwoWay, input triggers and suppression of queued own-write echoes | Binding, Hosts | B, BB, JE, MB |
| #1782 | T04.4 | Four-argument converters, ConvertBack, null/Unset/failure fallback | Binding, Managed members | B, BB, MB |
| #1783 | T04.5 | DataContext, ElementName, Self and TemplatedParent source resolution | Binding, Resources | B, BB, TL |
| #1784 | T04.6 | TemplateBinding through the binding engine and released Bind profile adapter | Binding, Resources | BB, TL, ST |
| #1785 | T04.7 | Shared target conversion for scalar, enum, layout and brush values | Binding, Resources | BB, XC, NV |
| #1786 | T04.8 | Structured SFB001–010 diagnostics and value redaction; injected host sink | Binding | BB, BR; Studio output successor |
| #1787 | T05.1 | Versioned JSON schema, pure token descriptors and typed expression compiler | Compiled | CS, CC, EC |
| #1788 | T05.2 | Direct-token execution, per-step tracking and Initialize/Update/StopTracking | Compiled, Managed members | CC, BR, MB |
| #1789 | T05.3 | Method argument tracking, static/instance calls and zero/two-argument events | Compiled, Managed members | CC, EC, MB |
| #1790 | T05.4 | BindBack, pre-construction x:Load/FindName and scheduled item phases | Compiled, Resources | CC, EC, BR, IP |
| #1831 | T12.3 | Source/CIL workload registry, paired measurement harness and >20% gate | Perf | PB; measured baseline pending |

Each suffix in the table is prefixed with `SF-A15-`.

## Authored test inventory

All files below are under `tests/` unless stated otherwise.

| Key | Focused file(s) |
| --- | --- |
| R | `a15-property-registry.test.js` |
| S | `a15-property-store.test.js` |
| V | `a15-property-validation.test.js` |
| VB | `a15-property-value-boundaries.test.js` |
| SS | `a15-property-snapshot.test.js` |
| HC | `a15-property-host-capability.test.js` |
| O | `a15-property-observable.test.js` |
| OR | `a15-property-observable-rewind.test.js` |
| CH | `a15-property-churn.test.js` |
| VV | `a15-property-vectors.test.js` |
| B | `a15-property-bindings.test.js` |
| BB | `a15-property-binding-boundaries.test.js` |
| BR | `a15-property-binding-rewind.test.js` |
| CS | `a15-property-compiled-schema.test.js` |
| CC | `a15-property-compiled.test.js` |
| EC | `a15-property-expression-compiler.test.js` |
| MB | `a15-property-managed-binding.test.js`, `a15-managed-property-bridge.test.js` |
| MO | `a15-property-managed-observers.test.js` |
| ML | `a15-property-managed-lists.test.js` |
| JC | `a15-property-javascript-collections.test.js` |
| JE | `a15-property-javascript-events.test.js` |
| RD | `a15-property-rendering-defaults.test.js` |
| OM | `a15-object-model-compiler.test.js` |
| NV | `a15-nullable-values.test.js` |
| NB | `a15-nullable-boundary.test.js`, `a15-nullable-call-ret.test.js`, `a15-nullable-numeric.test.js`, `a15-nullable-registry.test.js` |
| CM | `a15-property-canonical-metadata.test.js`, `a15-property-framework-enums.test.js`, `a15-property-scalar-casts.test.js` |
| CP | `a15-property-value-copy.test.js`, `a15-framework-value-receivers.test.js` |
| IE | `a15-interface-events.test.js` |
| PF | `a15-cil-proof-union.test.js`, `a16-callback-stack-budget.test.js`, `a16-callback-runtime-events.test.js` |
| RS | `a15-resources-styles.test.js` |
| TL | `a15-templates-lifecycle.test.js`, `a15-templates-managed.test.js` |
| TG | `a15-template-gc.test.js` |
| XC | `a15-xaml-converters.test.js` |
| IP | `a15-items-group-presentation.test.js`, compiled phase fixtures in CC/BR |
| ST | Existing `styles-templates.test.js` regression coverage |
| A13 | Existing `animation13.test.js` regression coverage |
| PB | `a15-property-performance-budget.test.js` |

Portable tests include more than forty scalar boundary cases, every source precedence
pair, shared-brush fanout to 100 injected consumers, 10,000 binding lifetime cycles,
5,000-item model vector mutations, deferred-element creation/disposal, invalid descriptor
data, negative metadata/type/arity cases and callback-safe rewind. These model cases do not
by themselves prove equivalent behavior through public JavaScript or managed UI adapters.

Managed fixture helpers execute source, canonical, direct CIL and reassembled CIL. The
subtree fixture warms the heap, removes bound controls, forces collection, and checks
empty source handlers, record counts and pin counts. Resource-owned tests add 500-control
template/style replacement coverage. New exact-acceptance successors cover UserControl
registration, empty-name INPC changes, real host shared-value fanout, collection deltas,
compiled events/deferred scenes and Studio diagnostic delivery. Their existence and results
must be recorded separately before closing the corresponding acceptance criteria.

## Shared object model and runtime integration

The resource worktree owns the portable dispatcher, trees and lifecycle models; the
compiler/runtime integration supplies their actual managed execution boundary.

| Issue | Work ID | Shared implementation and evidence |
| --- | --- | --- |
| #892 | SF-A15-T13 | DispatcherQueue adapter invokes source/CIL delegates through the existing queue. Resource exact-acceptance cases cover Task continuation enqueueing. |
| #893 | SF-A15-T14 | Real routed subscriptions preserve ordinary/AddHandler ordering, shared arguments and removal. JE and IE cover JavaScript routing and managed interface accessors; A16 owns acknowledged host events. |
| #894 | SF-A15-T15 | Compiler UI subclass profile, declared member metadata, inherited object storage and verified virtual invocation. CM, CP and resource object-model fixtures cover Control/UserControl/Page/Application paths. |
| #895 | SF-A15-T16 | Managed and JavaScript tree services distinguish logical, visual and templated parents; item mutation preserves both ownership and scene order. JC and resource object-tree fixtures cover the shared model. |
| #896 | SF-A15-T17 | Application/window lifetime, Loaded/Unloaded and protected layout properties use the shared context and store. Resource lifecycle fixtures and the separate A16 layout host cover real measure/arrange behavior. |
| #897 | SF-A15-T18 | Declared-owner reference casts preserve managed type identity and reject unrelated types. CM and the scalar-cast fixture cover approved UI boundaries; main CLR cast/storage tests retain their independent constraints. |

The post-main runtime also merges private stack proofs only for the same verified inspector
and unchanged method bodies. Callback scopes retain live frames and managed addresses
during nested calls, retire reservations on abort/pause, and expose those frames to precise
GC and method-event accounting. PF contains the focused positive and negative cases.

## Concrete integration and reference limits

- Framework contract signatures and released ids remain intact. Additive contracts use
  the A15 reservation; root owns registration manifest and compiler/runtime dispatch glue.
- Source-image compiled bindings require the matching emitted assembly or injected
  authoritative metadata. Direct CIL uses its own inspector. Dynamic XAML compiles its
  approved expressions during object-writer initialization; no unrelated offline XAML
  asset/build pipeline is claimed by this implementation.
- The portable compiled profile excludes the full C# expression language and reflective
  fallback. Compiled array index expressions without real accessor metadata are diagnosed;
  general Binding retains actual managed array access and bounds. Additional vector generic
  specializations need a declared framework contribution.
- Native WinUI/CLR reference comparison, Rust/Wasm UI execution and browser visual/accessibility
  runs have not been performed by this worktree. Managed/source/CIL fixtures are not a
  substitute for those targets. Unsupported target profiles must remain explicit in PRs.
- The next consolidated gate must qualify new-main generic Nullable/struct compatibility,
  temporal nullable call/return and quota behavior, newly admitted callback proofs, all
  managed/JavaScript host fixtures and the exact-acceptance successors together. Nullable
  ChangeView fixtures require the completed A16 layout host; portable metadata alone is
  insufficient. The performance baseline is a required recorded artifact, not an inferred
  number. These are qualification tasks, not implicit passing results.

## Property performance protocol

The workload registry is `scripts/benchmarks/a15-property-registry.json`. It declares
set, clear, style-refresh and INPC binding-update workloads on both source and CIL engines.
`a15-property-system.mjs` records throughput, median/p95 latency, managed allocations and
managed bytes per operation. Node heap deltas are recorded separately; they are not a
native allocator measurement.

`planning/qualification/property-performance-budget.json` requires at least twenty samples
and rejects a regression greater than 20% in median, p95, allocation count or managed bytes.
Missing workloads/counters and environment/harness mismatches fail. Zero-baseline growth
also fails. `.github/workflows/perf.yml` invokes the gate in the existing full performance job.

After the full-scope qualification commit is known, the coordinator must capture an initial
paired A/A run, inspect its raw samples, commit the actual baseline identity and preserve
the produced measurement report. The command is:

```sh
node scripts/benchmarks/a15-property-gate.mjs --base <qualified-commit> --head <qualified-commit> --output <artifact-directory>
```

Subsequent qualification compares a proposed head with that exact recorded baseline. Until
this measurement is complete, #1831 remains pending qualification and no speedup or budget
compliance is asserted.
