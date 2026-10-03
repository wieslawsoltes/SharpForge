# Property and resource authoring

The authoring APIs are exported from `@sharpforge/designer`. Editors are instance-scoped, dependency-free and use the existing
`DesignDocument` transaction/history contract. A failed edit does not alter the document, selection, revision or undo history.
Collection and template dialogs work on isolated drafts and reject stale revisions when applied.

## Public composition contracts

| API | Responsibility |
| --- | --- |
| `designerMetadata`, `designerPropertySchema`, `designerChildSlot` | Metadata derived from the framework manifest, including explicit attached-property owners, categories and numeric bounds. |
| `PropertyEditorRegistry`, `createPropertyEditorRegistry` | Ordered, disposable registrations with per-factory failure isolation. Factories receive a context; the host renders returned diagnostics inline. |
| `DesignerPropertyCommands` | Atomic local value, reset, binding, resource-reference and convert-to-resource operations across selections. |
| `designerPropertyRows`, `designerPropertySource`, `DesignerPropertyGridState` | Common-property intersection, mixed values, name/value search, category/name/source ordering and persisted collapse state. |
| `compatibleDesignerHandlers`, `designerEventSourceAccess`, `designerEventHandlerRequest`, `setDesignerEventHandler` | Delegate-signature filtering, protected subscription inspection and explicit source-service requests. |
| `DesignerCollectionDraft` | Add, remove, reorder and edit scalar/object Items or Grid definition drafts; one optimistic commit. |
| `DesignerStyleCommands` | Extract selection values, apply existing styles, edit copies and move local values into setters. |
| `DesignerTemplateScope` | Isolated template tree editing, TemplateBinding changes, commit/cancel and owner revision checks. |
| `addDesignerVisualState`, `recordDesignerStateProperty`, `setDesignerStateTransition` | Named state groups, typed setter recording and bounded transition durations in milliseconds. |
| `renameDesignerResource`, `importDesignerAuthoringResources` | Atomic reference updates and collision-safe clipboard resource imports. |
| `importDesignerTemplateResources` | Imports cloned template dependencies before a destination key is compared or reused. |
| `pruneDesignerAuthoring`, `copyDesignerAuthoringNodeMetadata`, `remapDesignerAuthoringNodeIds` | Pure deletion/clipboard hooks for sample data, state targets, ElementName bindings and adaptive overrides. |
| `createDesignerResourceDocument`, `generateDesignerResourceClass` | Resource-class editing and WinUI ResourceDictionary source export. |
| `designerInstancePreviews`, `projectDesignerState` | Ten independent theme/state scenes and pure state projection. |
| `DesignerStateTransition` | Bounded property-delta playback; deterministic elapsed milliseconds, exact endpoints and disposal. |
| `setDesignerSampleData`, `createDesignerSampleItems` | Design-only properties, binding samples and sample Items. |
| `createDesignerRoot`, `DesignerRootRegistry` | Page/UserControl/ContentDialog roots and bounded nested project-control previews from successful compilation metadata. |
| `designerAssets`, `designerAssetUri`, `referencedDesignerAssets`, `DesignerAssetPreviewStore` | Authorized project assets, escaped relative URIs, bounded loading and object-URL disposal. |
| `DesignerOptionsService` | Persisted view, orientation, zoom, snap, auto-sync, naming and property-grid preferences through an injected settings service. |

## Serialized authoring data

Existing `nodes[].properties`, `styles`, `templates`, Grid `rows` and `columns` retain their meaning. Additional data is explicit:

```js
node.bindings = { Content: { path: 'Customer.Name', mode: 'OneWay' } };
node.resourceReferences = { Background: { kind: 'theme', key: 'AccentBrush' } };
node.collections = { Items: ['One', { type: 'Microsoft.UI.Xaml.Controls.ComboBoxItem', properties: { Content: 'Two' } }] };
design.resources = {
  AccentBrush: { kind: 'theme', type: 'Microsoft.UI.Xaml.Media.Brush', variants: {
    default: { valueType: 'Microsoft.UI.Xaml.Media.SolidColorBrush', Color: { A: 255, R: 0, G: 120, B: 212 } }
  } }
};
design.designTime = { version: 1, nodes: { list: { items: ['Sample 1', 'Sample 2'] } } };
```

A property has one local source: a literal, binding, or resource reference. Commands remove competing local sources atomically.
Reset reveals existing style/default values. Bindings are stored as protected expressions and are never evaluated by the property grid.
The preview can use explicit `designTime.nodes[id].bindingValues` without running a converter or application code.
Event editing accepts a source binding capability through `setDesignerEventHandler(document, id, event, name, { handlers, sourceBinding })`;
the existing handlers-array argument remains supported. Navigate-only, lambda and multiple subscriptions reject mutation before a
document transaction. The Events inspector shows their reason and routes navigation through the source service's baseline check.

Gradients store `valueType`, `StartPoint`, `EndPoint`, `Opacity`, and `GradientStops` with `Color` and `Offset`. Colors use WinUI
`#RRGGBB` / `#AARRGGBB` ordering. Gradients allow 2–64 stable ordered stops. Collection editors allow up to 1,000 entries.
Nested project-control previews enforce depth and node limits and reject recursive compositions.

## Model and UI integration

The model's existing validator calls `validateDesignerAuthoring(document, { normalizeProperty, propertySchema, childSlot })` after
ordinary tree validation. `normalizeExtendedDesignerProperty(type, name, value, schema)` is the first normalization seam for typed brushes
and flags. These low-level modules do not import the document model and cannot create initialization cycles.

`projectDesignerAuthoringScene(design, scene, options)` adds resource values, collections and sample data to a cloned preview. Its
`resolveAsset` callback accepts only already authorized asset URIs. `designerPreviewDecorations(scene)` supplies validated gradient
decorations after the retained host's layout pass. No design-only metadata enters generated C# or a live runtime patch.

The Studio composition uses `DesignerPropertyController`, `DesignerResourceController` and `DesignerOptionsController`. Resource
controllers expose a `scopedDocument` and breadcrumb context; the document host provides explicit template-scope enter/leave hooks.
Resource preview uses the host's `buildPreviewScene()` when supplied, preserving the active theme, samples, component and asset projection.
Every preview host and asset URL is disposed when its owner closes. Editor errors remain in their own row so other rows stay usable.
`DesignerAssetPreviewController.refresh()` loads referenced project images when a document opens; its stale-generation check prevents
an old image load from replacing a newer document preview. The host calls `refresh()` after document updates and disposes the controller
when it closes. The controller returns loading diagnostics and refreshes only the preview after successful reads.

The tree owner calls `pruneDesignerAuthoring(candidate, removedIds)` after deleting or ungrouping nodes. The clipboard owner imports
template resource dependencies before choosing template keys and calls `copyDesignerAuthoringNodeMetadata(source, destination, idMap)`
once after all copied node identities are known. `remapDesignerAuthoringNodeIds(fragment, idMap)` is a lower-level hook for an isolated
fragment; passing the whole destination to this remapper would incorrectly retarget existing destination nodes. Template states live
on the isolated scope root while editing, so normal delete/undo operations also retain valid template state targets.

Transitions precompute the changed-property list once. `commandsAt(elapsedMs)` returns a borrowed command array for immediate host
application; callers that retain frames must clone it. Double and solid-color values interpolate; discrete values and unsupported
compound animations switch at completion. The Studio player uses an animation-frame clock and cancels stale document revisions,
owner disposal and other previews. Stopping a preview restores the base scene without changing document history. Template-state
projection applies all instance prefixes in one scene pass rather than cloning the full scene once per instance.

Asset previews deduplicate concurrent reads, limit each image to 8 MiB, and use a default document budget of 64 MiB, 512 entries and
four concurrent reads. The caller supplies read, Blob, object-URL creation and revocation services explicitly. Queued work is rejected
when its owner closes; an in-flight read cannot create a URL after disposal. Budget or payload failures remain visible diagnostics.

## Source generation and qualification boundaries

The default `generateDesignCode()` and `generateDesignProject()` retain the SharpForge browser/runtime profile. Scalar properties,
solid brushes, uniform/four-component layout values, styles, portable templates, ordered object/scalar Items, and Grid definitions use
the existing compiler/runtime contracts. Design-only samples are never emitted in `.cs` files.

The framework contract in this revision does not expose LinearGradientBrush, Binding, ResourceDictionary, or VisualState runtime APIs.
These constructs are authored, validated and previewed. `designCodegenDiagnostics` reports `SFD1872` and default generation refuses
to present them as executable browser-profile code. `generateDesignCode(design, { target: 'winui' })` and `generateDesignXaml(design)`
provide explicit Microsoft WinUI source export. Rich theme/template/binding/state output uses public declarative WinUI markup; simpler
gradient properties use typed C# construction. Resource dictionary classes have a separate export API. Native WinUI compilation and
deployment require the consumer's platform host project and are not claimed as browser-VM validation.

`readExtendedDesignerSourceValue(node, read)` lets the source reader recover closed gradient/point/stop constructors without executing
source. Unrecognized expressions remain protected. `generateDesignerNodeStatements` is the ordered collection/reference emitter
available to source planning. A source operation still must pass the source service's candidate compilation gate.

The focused qualification files are `tests/a18-property-values.test.js`, `tests/a18-property-resources.test.js` and
`tests/a18-property-design-data.test.js`. Ordered collection source is compiled and run on source and direct CIL VMs. Negative and
boundary tests cover error isolation, invalid values, stale drafts, undo, reference rename, sample-data exclusion, recursive/stale
project metadata, bounded assets, URL disposal and settings write failures. Browser rendering and native WinUI runtime behavior
require their respective integration jobs; package-level tests do not claim those platforms passed.

## Metadata lookup measurement

Run `node packages/designer/benchmarks/metadata.mjs` from the repository root after workspace linking. The fixture performs seven
samples, warms 100 schema lookups, reports the median fourth sample and the maximum as the seven-sample p95 estimate. Measurements
below used Linux, Node v24.19.0, AMD EPYC 9V74 80-Core Processor in the same workspace before and after the immutable schema cache.

| Operation | Before median / p95 (ms) | After median / p95 (ms) |
| --- | --- | --- |
| 10,000 Button schema lookups | 490.059 / 561.684 | 1.844 / 2.397 |
| Validate Canvas with 500 Button controls | 140.631 / 177.117 | 3.468 / 6.597 |

The registry derives each canonical type's immutable schema once and indexes attached setters once. Repeated lookup returns the same
frozen descriptor map, with no per-lookup map allocation or full manifest scan. These measurements cover metadata and model validation;
they do not measure browser layout, compiler performance or native rendering.
