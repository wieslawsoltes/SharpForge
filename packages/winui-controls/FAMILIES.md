# Control families and application services

These public models and injectable renderer contributions are imported through `@sharpforge/winui-controls`. Managed host integration is supplied by later declared predecessors and never inferred from a pure model test.

## Family registration policy

`defaultControlTemplates`, `defaultControlTemplate`, `materializeDefaultControlStyle` and `controlVisualStates` describe actual named visuals, template bindings and per-instance states. Button style padding is applied once by managed layout. Unknown controls receive no fabricated template. Renderer registration preserves caller ownership and explicit override policy; capability requests remain host-owned.

## Application and window lifetime

`ApplicationSession`, `WindowSession`, `VisibilityLifecycle` and `ActivationService` own independent app/window state and events. Closing waits for cancellation and deferral decisions before finalization. Snapshot restoration does not replay external activation or device effects. Deadline clocks and platform services are injected.

## Localization and data transfer

`ResourceLoader`, `ResourceManager`, `ResourceMap`, `ResourceContext`, `importResw` and `languageFallbacks` own language refresh and resource lookup. `DataPackage`, `ClipboardService` and `LauncherService` retain explicit caller-supplied backends and origin/grant policy. Denied clipboard operations return a reason and denied launches return false; no global fallback clipboard is fabricated.

## Managed application adapters

`managedDataPackage` and `createDataPackageView` expose the same authoritative data-transfer state used by drag/drop and clipboard operations. Application/window and resource adapters register through the caller-owned UI extension registry. Windows finalize only after their managed Closed decision commits; the host supplies windowClosed/applicationExited and task/permission services.

## Items and sparse selection

`SelectionModel` and `SelectionMode` track current selection and stable duplicate occurrences. `ViewportItemSource` and `ViewportSelectionModel` consume count/revision plus bounded realized records; `GroupedItemIndex`, `ViewportGroupIndex` and `SemanticZoomModel` retain group identity. `visibleItemRange`, `navigationIndex` and `sourceItems` expose bounded source helpers. Materialized reconciliation is O(n); lookup and membership are indexed. Performance timings remain unmeasured.

## Navigation models and geometry

`NavigationFrame` commits cached/history state only after navigation succeeds. `PaneState` and `registerNavigationLayouts` share adaptive NavigationView and four SplitView modes with the renderer. Superseded pane decisions cannot close a newer state. Menus retain source identity and expansion state.

## Commands, accelerators and icons

`XamlUICommand`, `StandardUICommand`, `commandCanExecute` and `executeCommand` share command policy. `KeyboardAcceleratorRouter` waits for Handled decisions before default invocation. `partitionCommandBar` and `commandBarGeometry` preserve source order and explicit priority groups. Icon elements/sources validate glyphs and use the declared font fallback policy.

## Popup, dialog and tooltip ownership

`OverlayManager`, `DeferralGroup`, `dispatchDeferred` and `placeOverlay` own root-relative placement and close lifetimes. Opposite-edge flipping preserves alignment. Modal overlays contain focus and restore it on close; tooltips update aria-describedby without moving focus. A second pending ContentDialog.ShowAsync fails explicitly.

## Text and password models

`TextBuffer` owns selection, composition, replacement and undo/redo; offsets use UTF-16 code units and surrogate boundaries are preserved. `PasswordBuffer` exposes length-only snapshots and the exported `redactPasswordProperties` preserves the private-value boundary. `RichTextDocument` supports plain text and bounded formatting. Typography helpers retain explicit inheritance and typed weight/style values.

## Command geometry and text operations

`registerCommandLayouts` and `registerMenuLayouts` arrange the same partitioned commands used by native renderers. `TextCommandController` and `textCommandLabels` provide selection/history-aware actions. Paste first waits for its cancellable event, then applies the approved edit; unsupported clipboard capabilities produce an explicit result.

## Qualification

The complete A16 scope gate ran at d91e0817: 373 tests, 339 passed and 34 failed. Each publication manifest identifies its recorded cases and subsequent repairs; failures remain visible. Required core is pending on each exact publication tree. Native WinUI oracle, browser IME, codec, OS permission and performance evidence are separate qualifications. No speedup or native parity is claimed without a recorded measurement.
