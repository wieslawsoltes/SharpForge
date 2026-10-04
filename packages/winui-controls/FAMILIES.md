# Control families and application services

This package supplies control models, renderer contributions and managed API
adapters. The framework registers the API contracts; the JS application and VM
own managed values, tasks, collections and model lifetime. The retained host owns
DOM elements, layout, input and accessibility. Applications import the package
entry point, `@sharpforge/winui-controls`.

The Project 14 family implementation and its regression fixtures passed their
cases in the completed combined Node gate described below. Native WinUI behavior
and the browser matrix remain separate qualifications. The issue-level evidence
and remaining acceptance work are recorded in
[ACCEPTANCE.md](ACCEPTANCE.md). Metadata differences remain visible in
[parity/deviations.json](parity/deviations.json) and the generated API matrix.

## Registration and ownership

| Public contribution | Consumer and responsibility |
|---|---|
| `registerControlFamilyContracts(registry)` | Framework registration within the reserved A16 contract range. Adds missing types and members while preserving released IDs and binary signatures. |
| `controlFamilyEventContracts` | Exact declaring owner/event mapping to the concrete event-argument type. A released delegate signature is not replaced by this mapping. |
| `registerControlFamilyAdapters(registry)` | Pure operations in the shared UI extension registry. Receives the host's managed context; asynchronous services return `context.task(...)`. |
| `registerControlFamilies(registry)` | Renderer registration after legacy extraction. Uses the renderer registry's explicit override option. |
| `registerNavigationLayouts`, `registerCommandLayouts`, `registerMenuLayouts` | Shared layout contributions. Managed Arrange and native parts use the same geometry. |
| `createControlServices(options)` | Creates session-owned resources, application/activation services, permission policy, clipboard, launcher and interaction leases. |
| `getControlFamilyModel(context, receiver, kind)` | Shares the authoritative `selection`, `tree`, `text`, `richText`, `range`, `calendar`, `navigation` or `pane` model with managed operations and automation. Returns no password model. |
| `applyControlFamilyInput(context, receiver, event, payload, options)` | Reconciles structured host input with managed model state before application handlers. `emit: false` suppresses a duplicate notification. |
| `defaultControlTemplates`, `defaultControlTemplate`, `materializeDefaultControlStyle` | Immutable recipes and an injected materializer for actual managed default styles/templates. |

The managed context supplies object identity/type lookup, property reads/writes,
collection projection, allocation, owner-scoped state, event dispatch, managed
task creation and virtual method invocation. Models are stored under the owning
managed object. `retainedValues()` enumerates references that its GC must trace;
the model map does not independently root every owner. `snapshot()` and
`restore(snapshot)` capture authoritative model state without replaying future
events. DOM caches are recreated as needed.

Default templates create named `Grid`, `Border`, `ContentPresenter` and other
managed nodes. Most families mount their native behavior in `PART_BehaviorRoot`;
`HeaderPresenter` and `PanePresenter` retain separate visual ownership where
needed. `ScrollView` instead has a real `PART_ScrollPresenter`. Content templates,
item templates and generated containers come from the shared A15 materializer.
The family layer does not create a competing managed item generator.

## Models and control behavior

The JavaScript model APIs use the names below. Managed WinUI-style members use
their registered PascalCase names and signatures; these are separate interfaces.

| Family | Public model APIs and implemented behavior |
|---|---|
| Items and selectors | `SelectionModel`, `SelectionMode`, `ViewportItemSource`, `ViewportSelectionModel`, `TreeViewModel`, `GroupedItemIndex`, `ViewportGroupIndex`, `SemanticZoomModel`. Selection tracks duplicate occurrences, ranges, current item and collection changes. List/Grid/ItemsView share virtual placement and the generated containers; ComboBox, FlipView, PipsPager, RadioButtons, SelectorBar and BreadcrumbBar supply family behavior. |
| Text editing | `TextBuffer` provides UTF-16 selection, replacement, typing-run undo/redo, composition, casing and length limits. TextBox changes its native editor when `AcceptsReturn` changes while preserving the model, caret and focus. AutoSuggestBox owns the active suggestion and emits native reason values. |
| Passwords | `PasswordBuffer` holds a private value and length-only snapshots. Reveal modes affect the private input element. Secret changes use the host private-input channel; public scene state, ordinary events and automation text/value patterns never carry the password. |
| Rich text and display | `RichTextDocument`, rich text overflow, inline elements and typography use the shared text/formatting models. Microsoft.UI.Text document/range/selection contracts include typed format enums and out-string operations. Native text layout and browser font metrics still require platform qualification. |
| Buttons | Repeat timing, ClickMode, tri-state toggles, radio scopes, split/dropdown actions and hyperlink command/launch policy are shared with keyboard and automation invocation. `RepeatController` accepts an injected clock. |
| Navigation | `NavigationFrame` commits history/cache changes after synchronous cancellation and page callbacks. `PaneState` and shared navigation geometry implement adaptive NavigationView and four SplitView modes. TabView preserves collection order during reordering; Pivot honors locked navigation. |
| Overlays | `OverlayManager`, `DeferralGroup`, `dispatchDeferred` and `placeOverlay` provide root-relative portals, opposite-edge flipping, aligned placement, LIFO dismissal, modal focus containment and bounded deferrals. ContentDialog rejects a second pending `ShowAsync`; tooltip descriptions follow the open lifetime without moving focus. |
| Commands | `XamlUICommand`, `StandardUICommand`, `KeyboardAcceleratorRouter` and `TextCommandController` share CanExecute, selected text and history. Menus implement nested keyboard traversal, radio groups and MenuBar Alt/F10 entry. Command overflow preserves source collections and moves equal explicit priority groups together. |
| Values and status | `NumericRange`, `CultureNumberFormatter`, `CalendarModel`, date/time helpers and RGB/HSV conversion implement validation, clamping, stepping, selected dates, blackout dates and status changes. Nullable selected date/time APIs preserve missing values separately from zero. |
| Application and windows | `ApplicationSession`, `WindowSession`, `VisibilityLifecycle` and `ActivationService` own application events, independent logical roots, cancellable/deferrable close, visibility, suspend/resume and activation policy. Root finalization occurs after a committed close. |
| Resources and transfer | `ResourceLoader`, `ResourceManager`, `ResourceMap`, `ResourceContext`, `importResw`, `DataPackage`, `ClipboardService` and `LauncherService` use explicit per-application services. UID bindings refresh when the selected language changes and missing keys return an empty string. |
| Media | `BitmapImage`, `WriteableBitmap`, `WebViewSession`, `MediaPlayerSession`, `PlatformControlSession` and `InkStrokeModel` share explicit resource and capability policy. WriteableBitmap uses the rendering package's authoritative pixel buffer. Playback uses an actual HTML media element. |

`SelectionModel` reconciles a materialized collection in O(n), with O(1)
occurrence lookup and membership. Large host scenes use the sparse `$items`
projection: count, source revision, stable occurrence keys and at most 2,048
realized records. They do not transmit one million placeholder items during
scrolling. Shared virtualization owns variable-size indexing and element reuse.
The managed source remains authoritative for off-screen values and selection.
Group headers and the materialized ItemsPanel are managed scene references.

Limits are explicit: materialized selection sources allow at most 1,000,000
items; tree models bound node traversal; AutoSuggestBox allows 2,048 suggestions;
command collections allow 10,000 entries; text is capped at 16 Mi UTF-16 code
units, with at most 1,000 configured history entries. A pending acknowledged
editor queue allows 128 operations. History and long-lived references count
toward the application's runtime memory limits.

## Events, cancellation and deferrals

Notifications use the normal event channel. Decisions use
`context.requestEvent(node, name, payload, { signal })`, which waits for managed
or JS handlers and their deferrals before applying the default action. The host
limits request count and duration and aborts requests when their target or root
is removed. Native-only hosts retain an in-process fallback.

| Decision | Outcome consumed by the family |
|---|---|
| `BeforeTextChanging` | `Cancel`; `NewText` is normalized before dispatch. |
| `Paste` | `Handled` or `Cancel`; an approved paste then passes through text validation. |
| `PasswordChanging` | `Cancel`; the transported payload contains `Length`, never secret text. |
| `PaneClosing` / pane transitions | `Cancel`; a superseded response cannot change a newer pane state. |
| `ContextRequested`, `AccessKeyInvoked`, accelerator `Invoked` | `Handled`; the native browser default is prevented while waiting. |
| Dialog button / overlay closing | `Cancel` and explicit `GetDeferral` completion. |
| `RefreshRequested` | Deferrals finish before the refresh operation returns to idle. |
| `InfoBar.Closing` | `Cancel` and close reason. |

Worker messages contain structured data and managed references. DOM events,
AbortSignal objects, functions and private password text never form event
payloads. Deferrals complete exactly once and have a deadline. Pending external
operations cannot be silently snapshotted; the model reports an explicit
diagnostic when it cannot restore their side effects.

Released events that already use `RoutedEventHandler` keep that ABI. The runtime
constructs concrete argument objects, but C# handlers need an explicit cast to
access newly added fields or `GetDeferral`. That source-inference difference is
recorded as `A16-RELEASED-EVENT-DELEGATES`, not counted as an exact native match.

## Host services and platform policy

`createControlServices` accepts injected `permissionPolicy`, `clipboard`,
`ClipboardItem`, `Blob`, `open`, `platform`, `windowPlatform`, resource/language
options, `document`, `window`, activation URL and launch queue. Existing service
instances can be supplied for explicit shared ownership. Call `dispose()` when
the owning application ends. Injected objects remain owned by their caller.

Constructing controls does not request a platform grant. Origins must be allowed
before image, media, hyperlink or embedded-page navigation. Clipboard and launch
operations also consult the explicit capability request callback. A denied
clipboard operation returns `{ ok: false, reason }`; a denied launcher returns
`false`. No process-global clipboard replaces a denied or absent browser API.

| Surface | Supported profile and remaining limit |
|---|---|
| Images | Granted HTTP(S), bounded raster data URIs and blob URLs. Missing/failed resources raise failure events. Pixel buffers use exact RGBA data. Native decoder/metric comparisons require evidence. |
| Clipboard | Text, HTML and URI formats through the actual injected backend. Drop StorageItems is an opaque, separately authorized capability; file handles never enter ordinary scene snapshots. Clipboard bitmap transfer is not declared supported. |
| Activation | Launch and HTTP(S) protocol URL/query activation. Browser launchQueue file activation requires a file-activation grant. Native activation kinds unavailable to the browser report an explicit diagnostic. |
| AppWindow | Logical size, position, visibility and events are session-local. Fullscreen/compact-overlay presenters require host adapters; missing presenters report `SFUI16A8`. Multi-process native window APIs are not fabricated. |
| WebView2 | Sandboxed iframe navigation with an origin policy. Native CoreWebView2/process APIs are unavailable; `ExecuteScriptAsync` reports `SFUI16B5`. Cross-origin iframe failure observation has browser limits. |
| MediaPlayerElement | Actual video playback, pause, seek and native transport controls. Codec availability, autoplay policy, DRM and devices remain browser/platform-specific. Unsupported MediaSource kinds raise MediaFailed. |
| Map/Capture/animated visuals | Explicit host adapters and grants are required. Unsupported managed Map/Capture construction reports `SFUI1633`; a missing native attachment adapter reports `SFUI16B9`. Animated visuals display declared fallback content when the adapter is absent. InkCanvas supports bounded pointer strokes, not native handwriting recognition. |
| Typography | CSS font features and an explicit Segoe UI Variable / Segoe UI / system-ui fallback stack. Metric equivalence is unverified without licensed fonts and a Windows reference. |
| Calendar | Gregorian UTC date arithmetic and culture-specific fields. Other calendar systems report `SFUI1686`. |

The released Orientation encoding remains Vertical=0 / Horizontal=1 even though
native WinUI uses the reverse numeric values. Released string signatures for
Image.Source, Control.FontFamily and some date/time properties remain compatible;
typed companions are separate, explicitly documented additions. NavigationView's
Top mode currently scrolls its top items horizontally rather than implementing a
native overflow dropdown. Native TabView dragstart cannot wait for a worker
cancellation response; in-process cancellation and collection reordering do not
qualify that worker scenario.

Clearing `SelectedDate` or `SelectedTime` represents absence in the nullable
selection property and its selected-value event. The non-nullable `DateValue`
and `TimeValue` companions retain their last/default typed value. An absent
selection displays the picker placeholder even when that companion is present;
midnight remains a present zero-valued TimeSpan.

## Examples and qualification

The executable [family-models.mjs](examples/family-models.mjs) demonstrates stable
selection, text cancellation/history, frame caching, numeric range changes,
language refresh and an explicitly denied clipboard operation without a browser.
It imports only the public package entry point:

```sh
node packages/winui-controls/examples/family-models.mjs
```

The retained-scene gallery is authored in `tests/helpers/a16-family-scenes.js`.
The consolidated browser runner consumes the command, overlay and media helpers
in `tests/helpers/a16-family-*-browser.js`; the media test uses the local synthetic
MP4 with real transport controls. Injected clipboard evidence is labeled as such.
The browser fixture is not Windows oracle output or real IME qualification.

The combined A15/A16/A17 Node gate at
`a41a1767e16761f6f28cff0a611b885b2209d08c` ran 1,338 tests: 1,320 passed and 18
failed in other shared scopes. Every A16 case passed, including nullable picker,
tri-state boxing, inherited inline typography and bitmap boundary regressions.
The generated log is
`artifacts/results/project14/complete-repaired-epics-gate.log`. This result does
not qualify the actual browser fixture or native Windows behavior.

Subsequent verification should address a concrete remaining failure or the
separately scheduled browser/native matrix. Run targeted family/service cases
through the repository limiter when a new change requires them; keep heavyweight
jobs serialized:

```sh
node scripts/limited.js node --test tests/a16-family-*.test.js tests/a16-services-*.test.js
```

Exact test commands, integrated commits, engine/browser versions, allocation and
latency measurements must accompany qualification. Per-control allocation and
latency measurements are not claimed here. Metadata import and matrix generation
use the separate procedure in [parity/METADATA.md](parity/METADATA.md).
The inventory denominator includes missing and mismatched WinUI members; BCL and
SharpForge-only extensions are excluded from WinUI coverage counts.
