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
| `compatibleDesignerHandlers`, `designerEventHandlerRequest`, `setDesignerEventHandler` | Delegate-signature filtering and explicit requests for the source service to create/navigate managed handlers. |
| `DesignerCollectionDraft` | Add, remove, reorder and edit scalar/object Items or Grid definition drafts; one optimistic commit. |
| `DesignerStyleCommands` | Extract selection values, apply existing styles, edit copies and move local values into setters. |
| `DesignerTemplateScope` | Isolated template tree editing, TemplateBinding changes, commit/cancel and owner revision checks. |
| `addDesignerVisualState`, `recordDesignerStateProperty`, `setDesignerStateTransition` | Named state groups, typed setter recording and bounded transition durations in milliseconds. |
| `renameDesignerResource`, `importDesignerAuthoringResources` | Atomic reference updates and collision-safe clipboard resource imports. |
| `createDesignerResourceDocument`, `generateDesignerResourceClass` | Resource-class editing and WinUI ResourceDictionary source export. |
| `designerInstancePreviews`, `projectDesignerState` | Ten independent theme/state scenes and pure state projection. |
| `setDesignerSampleData`, `createDesignerSampleItems` | Design-only properties, binding samples and sample Items. |
| `createDesignerRoot`, `DesignerRootRegistry` | Page/UserControl/ContentDialog roots and bounded nested project-control previews from successful compilation metadata. |
| `designerAssets`, `designerAssetUri`, `DesignerAssetPreviewStore` | Authorized project assets, escaped relative URIs, thumbnail lifecycle and object-URL disposal. |
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
Every preview host and asset URL is disposed when its owner closes. Editor errors remain in their own row so other rows stay usable.

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
