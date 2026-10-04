# Control families and application services

These public models and injectable renderer contributions are imported through `@sharpforge/winui-controls`. Managed host integration is supplied by later declared predecessors and never inferred from a pure model test.

## Family registration policy

`defaultControlTemplates`, `defaultControlTemplate`, `materializeDefaultControlStyle` and `controlVisualStates` describe actual named visuals, template bindings and per-instance states. Button style padding is applied once by managed layout. Unknown controls receive no fabricated template. Renderer registration preserves caller ownership and explicit override policy; capability requests remain host-owned.

## Items and sparse selection

`SelectionModel` and `SelectionMode` track current selection and stable duplicate occurrences. `ViewportItemSource` and `ViewportSelectionModel` consume count/revision plus bounded realized records; `GroupedItemIndex`, `ViewportGroupIndex` and `SemanticZoomModel` retain group identity. `visibleItemRange`, `navigationIndex` and `sourceItems` expose bounded source helpers. Materialized reconciliation is O(n); lookup and membership are indexed. Performance timings remain unmeasured.

## TreeView model

`TreeViewModel` traverses iteratively, rejects cyclic or multiply owned children, computes mixed ancestors and preserves graph state across snapshots. Collapsing or disposing a node invalidates pending expansion work. Renderer registration is explicit; virtualization and automation qualification remain staged.

## Virtual item families

Virtual list/grid/item views consume stable occurrence keys and at most 2,048 realized sparse records. Shared layouts own extent/realization and generated managed containers own item templates/styles. Group headers, empty groups and ItemsPanelTemplate roots are retained references. `getSelectionModel` and `scrollItemIntoView` expose the renderer state to input/automation services.

## Qualification

The complete A16 scope gate ran at d91e0817: 373 tests, 339 passed and 34 failed. Each publication manifest identifies its recorded cases and subsequent repairs; failures remain visible. Required core is pending on each exact publication tree. Native WinUI oracle, browser IME, codec, OS permission and performance evidence are separate qualifications. No speedup or native parity is claimed without a recorded measurement.
