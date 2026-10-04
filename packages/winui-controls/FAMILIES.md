# Control families and application services

These public models and injectable renderer contributions are imported through `@sharpforge/winui-controls`. Managed host integration is supplied by later declared predecessors and never inferred from a pure model test.

## Family registration policy

`defaultControlTemplates`, `defaultControlTemplate`, `materializeDefaultControlStyle` and `controlVisualStates` describe actual named visuals, template bindings and per-instance states. Button style padding is applied once by managed layout. Unknown controls receive no fabricated template. Renderer registration preserves caller ownership and explicit override policy; capability requests remain host-owned.

## Commands, accelerators and icons

`XamlUICommand`, `StandardUICommand`, `commandCanExecute` and `executeCommand` share command policy. `KeyboardAcceleratorRouter` waits for Handled decisions before default invocation. `partitionCommandBar` and `commandBarGeometry` preserve source order and explicit priority groups. Icon elements/sources validate glyphs and use the declared font fallback policy.

## Application and window lifetime

`ApplicationSession`, `WindowSession`, `VisibilityLifecycle` and `ActivationService` own independent app/window state and events. Closing waits for cancellation and deferral decisions before finalization. Snapshot restoration does not replay external activation or device effects. Deadline clocks and platform services are injected.

## Popup, dialog and tooltip ownership

`OverlayManager`, `DeferralGroup`, `dispatchDeferred` and `placeOverlay` own root-relative placement and close lifetimes. Opposite-edge flipping preserves alignment. Modal overlays contain focus and restore it on close; tooltips update aria-describedby without moving focus. A second pending ContentDialog.ShowAsync fails explicitly.

## Text and password models

`TextBuffer` owns selection, composition, replacement and undo/redo; offsets use UTF-16 code units and surrogate boundaries are preserved. `PasswordBuffer` exposes length-only snapshots and the exported `redactPasswordProperties` preserves the private-value boundary. `RichTextDocument` supports plain text and bounded formatting. Typography helpers retain explicit inheritance and typed weight/style values.

## Localization and data transfer

`ResourceLoader`, `ResourceManager`, `ResourceMap`, `ResourceContext`, `importResw` and `languageFallbacks` own language refresh and resource lookup. `DataPackage`, `ClipboardService` and `LauncherService` retain explicit caller-supplied backends and origin/grant policy. Denied clipboard operations return a reason and denied launches return false; no global fallback clipboard is fabricated.

## Command geometry and text operations

`registerCommandLayouts` and `registerMenuLayouts` arrange the same partitioned commands used by native renderers. `TextCommandController` and `textCommandLabels` provide selection/history-aware actions. Paste first waits for its cancellable event, then applies the approved edit; unsupported clipboard capabilities produce an explicit result.

## Menus and interaction routing

`registerCommandsRenderers` registers nested menus, command bars, text flyouts and gesture controls. `RefreshController` deduplicates outstanding requests and propagates rejected handlers. Context and access key bindings share owner-scoped teardown and wait for Handled before the native default action.

## Button behavior

`RepeatController` accepts a manual clock and disposes outstanding timers. Button/toggle/check/radio, repeat, split/dropdown and hyperlink renderers share enabled/command policy, selected/indeterminate states and root-scoped radio ownership. Native behavior receives the existing managed template/content parts.

## Managed command and checked-state ABI

Synchronous command adapters invoke managed overrides through the supplied virtual-call seam. Checked state distinguishes true/false/null, preserves the released bool IsChecked property via the explicit indeterminate flag and boxes the object-valued GetChecked result.

## Qualification

The complete A16 scope gate ran at d91e0817: 373 tests, 339 passed and 34 failed. Each publication manifest identifies its recorded cases and subsequent repairs; failures remain visible. Required core is pending on each exact publication tree. Native WinUI oracle, browser IME, codec, OS permission and performance evidence are separate qualifications. No speedup or native parity is claimed without a recorded measurement.
