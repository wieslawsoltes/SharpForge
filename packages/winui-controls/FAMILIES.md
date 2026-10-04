# Control families and application services

These public models and injectable renderer contributions are imported through `@sharpforge/winui-controls`. Managed host integration is supplied by later declared predecessors and never inferred from a pure model test.

## Family registration policy

`defaultControlTemplates`, `defaultControlTemplate`, `materializeDefaultControlStyle` and `controlVisualStates` describe actual named visuals, template bindings and per-instance states. Button style padding is applied once by managed layout. Unknown controls receive no fabricated template. Renderer registration preserves caller ownership and explicit override policy; capability requests remain host-owned.

## Items and sparse selection

`SelectionModel` and `SelectionMode` track current selection and stable duplicate occurrences. `ViewportItemSource` and `ViewportSelectionModel` consume count/revision plus bounded realized records; `GroupedItemIndex`, `ViewportGroupIndex` and `SemanticZoomModel` retain group identity. `visibleItemRange`, `navigationIndex` and `sourceItems` expose bounded source helpers. Materialized reconciliation is O(n); lookup and membership are indexed. Performance timings remain unmeasured.

## Numeric, calendar and color values

`NumericRange`, `CultureNumberFormatter` and `evaluateNumericExpression` validate bounded input and share clamping/NaN policy. `CalendarModel`, `dateValue`, `dateText`, `timeValue`, `dateFieldOrder` and `dateFromFields` use Gregorian UTC arithmetic. RGB/HSV and ARGB helpers preserve channel values and explicit alpha.

## Commands, accelerators and icons

`XamlUICommand`, `StandardUICommand`, `commandCanExecute` and `executeCommand` share command policy. `KeyboardAcceleratorRouter` waits for Handled decisions before default invocation. `partitionCommandBar` and `commandBarGeometry` preserve source order and explicit priority groups. Icon elements/sources validate glyphs and use the declared font fallback policy.

## Application and window lifetime

`ApplicationSession`, `WindowSession`, `VisibilityLifecycle` and `ActivationService` own independent app/window state and events. Closing waits for cancellation and deferral decisions before finalization. Snapshot restoration does not replay external activation or device effects. Deadline clocks and platform services are injected.

## Popup, dialog and tooltip ownership

`OverlayManager`, `DeferralGroup`, `dispatchDeferred` and `placeOverlay` own root-relative placement and close lifetimes. Opposite-edge flipping preserves alignment. Modal overlays contain focus and restore it on close; tooltips update aria-describedby without moving focus. A second pending ContentDialog.ShowAsync fails explicitly.

## Value and status renderers

`registerValueRenderers`, `getRangeModel` and `getCalendarModel` share clamping, snapping, calendar bounds and selected state with managed input. Nullable selection displays a placeholder even when a non-nullable DateValue/TimeValue companion retains its last typed value; midnight remains present zero.

## Typed picker and range adapters

Clearing SelectedDate/SelectedTime changes the nullable selection and event payload; non-nullable DateValue/TimeValue keep their last/default typed value. Explicit null in a host event wins over stale companion data. Range input preserves NaN policy, clamping and indeterminate state.

## Qualification

The complete A16 scope gate ran at d91e0817: 373 tests, 339 passed and 34 failed. Each publication manifest identifies its recorded cases and subsequent repairs; failures remain visible. Required core is pending on each exact publication tree. Native WinUI oracle, browser IME, codec, OS permission and performance evidence are separate qualifications. No speedup or native parity is claimed without a recorded measurement.
