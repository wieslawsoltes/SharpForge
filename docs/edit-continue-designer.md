# Edit and Continue and WinUI Designer — 0.12.0

## Release provenance

This release was reconstructed from the available, verified 0.11.0 archive. The earlier claimed 0.12 source and working directory were not present and were not recovered. The new implementation, tests and distributables are created from that baseline. The separate validation report identifies actual results and qualification boundaries.

## Launch

Extract the source archive, then run:

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm start
```

Use the URL printed by the server. The standalone HTML contains the same application and two dedicated Blob workers, including all editor modes and the designer. Browser policy must permit inline scripts/Blob workers. Normal HTTP/file-origin operation and native permission dialogs were not qualified in this environment; browser acceptance injects production code into about:blank with real workers. There is no need to install a plugin, .NET SDK or server to compile and run supported browser-profile examples. The optional native MSBuild host still requires its installed toolchain and explicit trust.

## Start designing

Choose the **Designer** toolbar button. It opens a dedicated layout containing seven independent docking tools: WinUI Designer, Toolbox, Design Outline, Design Properties, Layout Editor, Styles & Templates and Design Source. They can float, regroup, auto-hide and use shared context menus. The workspace has 43 tools in total.

**New** starts a Window/Canvas document with title, caption and a styled Button. **Open** loads a `.sfdesign.json` record in the current workspace, or imports an explicit JSON file when none is present. **Save** records the design in the browser workspace. File → Save Workspace as ZIP preserves it together with sources, binaries and settings. The designer does not silently write native workspace files: native mode offers explicit export rather than claiming a native write happened.

Select a control in the surface or tree. Selection, properties, layout and resource editors track the same stable node ID. The tree supports keyboard navigation, search, multi-selection, drag/drop and reordering. Insert from the searchable toolbox; drag a toolbox item onto a container, or click with a destination selected. Invalid parent/child operations are rejected atomically. Copy/paste and duplicate generate independent identities and import referenced styles/templates without overwriting incompatible destination resources. Deletion, reparenting, grouping and ungrouping are undoable.

### Pixel editing

Canvas controls have authored Left/Top/Width/Height. Dragging and eight resize handles commit one undo operation per gesture. Coordinates account for zoom without accumulating DOM rounding drift. Snapping defaults to eight pixels; Alt bypasses to one-pixel increments. Use the arrow keys for nudging and the layout panel for alignment/distribution. Multi-selection preserves relative positions. Movement under a non-Canvas layout is rejected rather than quietly converting it to absolute positioning.

Use Ctrl/Command + wheel for anchor-preserving zoom, middle-button drag to pan, Fit for the artboard and Shift + background drag for marquee selection. Artboard width/height are bounded and editable. **Preview** switches off editing adorners and allows HTML interactions; arbitrary C# callbacks do not execute in the design-only surface. **Build & Run C#** creates the managed application for real callback execution.

### Layout editing

The Layout Editor configures margins, alignment, Grid row/column and spans, parent ordering and Grid definitions. Auto, pixels, `*` and `n*` are supported. In Layout mode, drag a child between Grid cells. Drag Grid boundary handles to resize adjacent definitions: a star/star pair retains its total proportional weight; mixed definitions become explicit pixels. Escape cancels an in-progress boundary gesture. Undo restores the original definitions. StackPanel uses flow layout; use the tree/order commands rather than attempting a pixel move.

### Property grid

Editable properties are generated from the actual framework registry, filtered by control type. Editors validate numbers, Boolean values, enums, names, brushes/colors, Thickness/CornerRadius and attached layout values. Search filters the property list. Multi-selection changes are transactional. Reset removes a local value and reveals the next precedence source; it does not force a guessed default. The property-source indicator distinguishes local, style, captured runtime and default values.

The Events section records managed method names for generated source. `Program.OnAction` gets a separate user-handler stub. Adding an event to a running object requires code compilation/Hot Reload; a visual-only patch does not silently compile or execute arbitrary text.

## Shared styles and templated controls

The Styles & Templates tool edits resource names, target types, BasedOn, implicit design styles, setters and template parts. Templates have their own part hierarchy, editable properties and owner-property bindings; JSON editing in Design Source permits complete supported tree edits. Resources are saved with the document, not just applied to transient DOM nodes. Generated C# creates actual managed Style, Setter and ControlTemplate objects.

The web profile implements **local value → template value → shared style/BasedOn → default** precedence. `ClearValue` reveals the lower source. `ReadLocalValue` returns the stable `DependencyProperty.UnsetValue` object when no local value exists; local null remains distinct. Inherited registered-property aliases have stable identity, including across collection. Shared setter changes update all consumers. Invalid target, value or collection edits roll back the resource and every affected control instead of leaving a partial update.

Each owner gets independent template parts and a separate name scope. `ApplyTemplate()` and `GetTemplateChild(name)` return the actual instance's parts. A local value on a part overrides its owner binding until cleared. Bound TextBox input goes back to the original managed owner and handler. Managed template objects survive garbage collection. This is data-driven visual templating: arbitrary event handlers on prototype parts are not copied into clones.

Example supported web-profile C#:

```csharp
Style accent = new Style("Button");
Setter size = new Setter(Button.FontSizeProperty, 20.0);
accent.Setters.Add(size);
Button first = new Button();
Button second = new Button();
first.Style = accent;
second.Style = accent;
second.FontSize = 30;
size.Value = 24.0; // first changes; second's local value wins
second.ClearValue(Button.FontSizeProperty); // now 24
```

`Style.TargetTypeName`, the string Style constructor, `ControlTemplate.VisualTree` and `ControlTemplate.Bind` are explicit web-profile conveniences. They are not representations of full native WinUI Type/XAML semantics. Native ResourceDictionary lookup, general bindings/DataContext, animation precedence, triggers/VisualStateManager and custom DependencyProperty.Register are not implemented by this release.

## Generate a complete project

**Build & Run C#** previews/confirms replacement of the current browser workspace, then writes:

- `View.sfdesign.json` — authoritative design data;
- `DesignedView.g.cs` — generated controls, hierarchy, styles, templates and event subscriptions;
- `Program.cs` — user entry point and separate event-handler methods;
- `DesignerApp.csproj` and `DesignerApp.slnx` — project/solution records.

Generated fields use `DesignedView.v_<nodeID>`. Do not edit the generated file and expect arbitrary text changes to reverse-map into the design: no general C# or XAML round-trip parser is claimed. Regeneration creates a new workspace after confirmation; keep user code/source backups or export the current workspace first. Use live attach/patch to retain an already running application's state instead of regenerating it.

## Live designer updates

Run a code-first WinUI application, open Designer, and choose **Attach running app**. Capture reads the actual managed scene and bindings; it does not invoke getters or user methods. Edit the captured hierarchy, properties, tracks, style or template, then choose **Apply to live**.

The delta targets existing allocation identities. It changes only explicitly edited properties and relationships, creates new supported objects, and detaches removed controls. Unchanged typed input, counter values, managed references and subscribed handlers remain intact. A removed visual can remain alive when referenced by user code; it is not forcibly freed. The API pins referenced objects during update and permits normal collection afterward.

Updates require the same active session/revision and paused, waiting or UI-idle execution. Running frames, stale allocation IDs, duplicate aliases, an incompatible root, unsupported properties/events or invalid hierarchy are rejected before/within a rollback-protected transaction. An application that has been stopped cannot be edited through an old attachment. Failed updates restore managed heap, output, execution and UI transaction state. A successful update invalidates reverse history so old visual snapshots cannot be replayed into the new design generation.

Source VM and direct-CIL live layout/style/template updates are tested. External native Windows applications are not attachable through this feature.

## Edit and Continue / Hot Reload

Open **Hot Reload**, choose **Edit code**, change source, then **Apply** or **Apply & Continue**. A candidate build is distinct from the running compilation. An unsuccessful candidate does not replace the current program, symbol mapping or managed state. Expected generation and session checks prevent stale application. Cancel restores the committed source snapshot.

| Update | Source VM | Direct CIL |
|---|---|---|
| Compatible method-body replacement | Supported | Supported with unchanged metadata/signature/layout |
| Add/reorder methods without ID drift | Supported | Requires restart for structural metadata changes |
| Add new types | Supported, if existing contracts remain compatible | Requires restart |
| Append fields to existing managed classes | Supported | Requires restart |
| Add/reorder static fields | Supported with existing identity/type retained | Requires restart |
| Remap compatible active locals | Supported at validated checkpoints | Existing strict body-update compatibility only |
| Rewrite/remove an active statement or enter another exception region | Rejected | Rejected |
| Native CLR MetadataUpdater/EnC delta emission | Not implemented | Not implemented |

Existing object IDs are preserved. Appended fields on existing objects receive language-default values; their initializers are not replayed. Newly constructed objects run the new initializer. Existing static values are preserved and added static storage defaults without replaying static constructors. Method/type/field identities are remapped, not inferred from new declaration order; old delegates continue to target their original methods.

An active top frame can move to the unique surviving source statement only at a checked empty-stack checkpoint. Locals are matched by stable name/type, ambiguous layouts are rejected, and needed skipped initializations are not fabricated. Suspended callers/await frames carrying evaluation state cannot be guessed into a different instruction layout. Unchanged suspended frames can call updated inactive helpers after resuming.

Field extension preflights the managed heap budget and rolls back on allocation failure. Signature/type removals, changing/reordering existing instance fields, incompatible exception regions and stale generations are rude edits requiring restart. Breakpoints are rebound and compatible data-breakpoint local descriptors are remapped. A successful code update advances the generation and clears reverse history. Rejected changes do not erase that history.

This is not unrestricted native .NET Edit and Continue. It does not add Roslyn delta generation, native process attachment, arbitrary CLR/BCL execution, operating-system thread semantics or native WinUI Hot Reload.

## New controls and profile boundaries

Sixteen additional controls are available: ToggleButton, RadioButton, NumberBox, AutoSuggestBox, CalendarDatePicker, TimePicker, InfoBar, ContentPresenter, Viewbox, TabView, TabViewItem, AppBarButton, CommandBar, ToolTip, ContentDialog and Separator. The registry now contains 101 named types and 795 ABI members, including task/thread/delegate/value/enum/helper types; those counts are not counts of complete WinUI controls. The designer toolbox offers 48 insertable controls plus its Window root.

NumberBox input updates managed Value and fires ValueChanged. Named radio groups synchronize checked state. Date/time controls use ISO-style strings in this profile, not WinRT DateTime/TimeSpan. Tab close raises CloseRequested; application code decides whether to remove the tab. ContentDialog uses profile Show/Hide methods and managed button events, not native ShowAsync modality. AutoSuggestBox provides text/query events but no built-in suggestion provider. CommandBar uses its child collection rather than a complete native command/overflow system. ToolTip has explicit IsOpen state, not a full native attached tooltip service. Viewbox scales supported DOM content. Separator is a decorative Controls-profile element.

Controls use semantic HTML, CSS layout and accessibility where applicable. Existing drawing surfaces retain selectable WebGPU/Canvas2D/DOM fallbacks; the designer is not an all-GPU compositor. This release does not establish native WinRT/Windows App SDK binary compatibility, XAML, unrestricted style/template/binding/animation systems or pixel-identical WinUI rendering.

## Examples and reproduction

Five complete folder/ZIP examples are under `examples/designer`: CanvasCounter, GridWorkspace, SharedStyles, ControlGallery and EditContinue. They are also present in Studio's Examples menu. CanvasCounter retains typed input and count during live edits. GridWorkspace covers tracks and a NumberBox. SharedStyles mutates a shared setter and uses independent TextBox templates. ControlGallery routes real numeric/radio/date/time/tab input. EditContinue includes before/after source and expected live values.

```sh
npm test
npm run check
npm run test:designer
npm run test:packages
npm run examples:designer
SHARPFORGE_IN_MEMORY=1 CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser:designer
CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:standalone
```

Node/package workflows are offline. Browser tests require Python Playwright and a Chromium executable. The validation report records the actual tested environment and outcomes. The stored design has 1,000-node/100-depth bounds, 64 tracks per axis, 500 parts per template, and 100 undo entries. The runtime transaction caps a single live patch at 5,000 commands. These are explicit resource limits, not complete Visual Studio-scale qualification.

## Public references

The source implementation was compared with Microsoft's dependency-property and edit/update guidance. Those documents describe native systems, not a certification of this implementation:

- https://learn.microsoft.com/en-us/windows/apps/develop/platform/xaml/dependency-properties-overview
- https://learn.microsoft.com/en-us/visualstudio/debugger/supported-code-changes-csharp
