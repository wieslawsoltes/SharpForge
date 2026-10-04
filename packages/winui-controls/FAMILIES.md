# Control families and application services

These public models and injectable renderer contributions are imported through `@sharpforge/winui-controls`. Managed host integration is supplied by later declared predecessors and never inferred from a pure model test.

## Family registration policy

`defaultControlTemplates`, `defaultControlTemplate`, `materializeDefaultControlStyle` and `controlVisualStates` describe actual named visuals, template bindings and per-instance states. Button style padding is applied once by managed layout. Unknown controls receive no fabricated template. Renderer registration preserves caller ownership and explicit override policy; capability requests remain host-owned.

## Text and password models

`TextBuffer` owns selection, composition, replacement and undo/redo; offsets use UTF-16 code units and surrogate boundaries are preserved. `PasswordBuffer` exposes length-only snapshots and the exported `redactPasswordProperties` preserves the private-value boundary. `RichTextDocument` supports plain text and bounded formatting. Typography helpers retain explicit inheritance and typed weight/style values.

## Inline display and rich overflow

`getRichTextDocument`, `applyTypography` and `renderRichDocument` consume immutable formatting spans and shared text metrics. Linked overflow fragments preserve UTF-16 ranges, selection and source-document identity. Typography and bidi geometry follow the injected renderer/font provider.

## Items and sparse selection

`SelectionModel` and `SelectionMode` track current selection and stable duplicate occurrences. `ViewportItemSource` and `ViewportSelectionModel` consume count/revision plus bounded realized records; `GroupedItemIndex`, `ViewportGroupIndex` and `SemanticZoomModel` retain group identity. `visibleItemRange`, `navigationIndex` and `sourceItems` expose bounded source helpers. Materialized reconciliation is O(n); lookup and membership are indexed. Performance timings remain unmeasured.

## Localization and data transfer

`ResourceLoader`, `ResourceManager`, `ResourceMap`, `ResourceContext`, `importResw` and `languageFallbacks` own language refresh and resource lookup. `DataPackage`, `ClipboardService` and `LauncherService` retain explicit caller-supplied backends and origin/grant policy. Denied clipboard operations return a reason and denied launches return false; no global fallback clipboard is fabricated.

## Editor and document contributions

`registerTextRenderers` and managed text adapters share TextBuffer/RichTextDocument. BeforeTextChanging and Paste decisions finish before editing; stale completions and disposal cannot mutate a newer editor. Secret text is absent from scene properties, ordinary events and password automation. Rich document contracts expose the bounded Microsoft.UI.Text profile, including explicit out-string writes.

## Qualification

The complete A16 scope gate ran at d91e0817: 373 tests, 339 passed and 34 failed. Each publication manifest identifies its recorded cases and subsequent repairs; failures remain visible. Required core is pending on each exact publication tree. Native WinUI oracle, browser IME, codec, OS permission and performance evidence are separate qualifications. No speedup or native parity is claimed without a recorded measurement.
