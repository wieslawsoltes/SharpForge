# Layout, input and virtualization contracts

All geometry is expressed in device-independent pixels. The DOM consumes rectangles produced by `LayoutEngine`;
CSS flex/grid, `offsetWidth` and `getBoundingClientRect()` do not determine control layout.
The root's client viewport and actual canvas font metrics are the browser inputs.

## Ownership and registration

`RendererRegistry` is instance-owned and resolves canonical names, short names and registered base types.
`register(types, renderer, { override: true })` explicitly replaces an extracted compatibility renderer.
Renderers receive a context containing `resolve`, `children`, `content`, `ordered`, `emit`, `invalidate`,
`getState`, `services`, `privateInput`, and the owning host. Event maps are keyed by DOM event name.
Creation, recreation, removal and disposal clean up renderer-owned state. New control families need no host switch branch.

`WinUIHost` remains the public facade. Its implementation, `RetainedWinUIHost`, receives framework and drawing
adapters instead of importing a higher-level package. This permits the framework to consume dependency-free
contract contributors without introducing a package cycle.

## Measure and arrange

`LayoutEngine.synchronize(nodes, roots)` establishes visual ownership and definition dependencies, rejecting cycles,
duplicate visual parents, excessive depth and oversized scenes. `invalidate(id, 'measure' | 'arrange')` propagates to
ancestors and dependent grids. Unchanged constraints and clean state skip their overrides. `updateLayout(viewport)`
runs a bounded convergence loop and accepts an AbortSignal. Calling it recursively is an explicit layout error.

`measureElement` and `arrangeElement` implement margin, explicit dimensions, min/max clamping, cross-axis alignment,
collapsed elements and device-pixel edge rounding. A measured desired size is distinct from its unclipped desired
size and final render size. `customLayout` accepts synchronous override adapters; asynchronous managed callbacks
require an explicit synchronous bridge and are rejected rather than reporting fabricated geometry.

Built-in algorithms cover Grid, StackPanel, Canvas, RelativePanel, WrapGrid, VariableSizedWrapGrid, Border,
ContentPresenter, Viewbox, scroll content, Expander, TwoPaneView and ParallaxView. Grid owns Auto/pixel/star
resolution, min/max saturation, span demand, spacing, padding and shared pixel edges. Definition mutations invalidate
their owner even though definitions are not visual children. RelativePanel solves horizontal and vertical dependency
graphs separately, so valid cross-axis references are not mistaken for cycles. Canvas does not clip by default.

`computeWorldLayout` adds world matrices, clips and transformed bounds. The same snapshot drives DOM placement,
renderer delegates, focus geometry and hit testing. Facade transforms do not change DesiredSize/RenderSize.

## Virtualization

An item source supplies `count`, `getAt(index)` and stable occurrence keys from `keyAt(index)`.
`ItemSizeIndex` stores estimated lengths plus a Fenwick index of measured deltas: update, prefix lookup and offset
search are O(log n), with O(n) numeric index storage. A million-item source is not materialized into visual nodes.

`RealizationWindow` produces a bounded visible range with cache and anchor compensation. `RecyclePool` clears old
item state before reuse. `ItemsRepeater` emits prepare/clear/index-change notifications and may retain one focused
container outside the realized range. List control selection belongs to the independent selection model, keyed by
item identity rather than recycled container identity.

Uniform grids compute visible rows arithmetically. LinedFlowLayout builds a line index in cancellable chunks before
serving viewport queries; callers must await `prepare(width)` when width or source count changes. It does not
silently use approximate line breaks. Incremental loading permits one in-flight request and aborts on disposal.

Host adapters can supply `services.resolveItemsSource` for managed collections and
`services.prepareItemTemplate` / `clearItemTemplate` for the A15 template engine.

## Input and private state

`RoutedEventRouter` implements direct, tunnel and bubble routes and handled-events-too listeners. Captures are scoped
per root and released on pointer cancellation, native capture loss, unload and disposal. The focus manager provides
cancellable focus transitions, stable TabIndex traversal, Once/Cycle scopes, directional lookup and explicit targets.
Gesture and manipulation recognizers consume pointer streams and cancel pending holds/drag state on removal.

`InputManager` reports typed data through `onRoutedEvent`. A worker bridge must serialize the data fields and hydrate
managed arguments; JavaScript convenience methods in pointer arguments are not transferable. Managed Handled,
deferral and custom-override execution need the runtime's registered host-operation adapter.

Passwords are delivered through `host.setPrivateValue` and `options.onPrivateInput`. They are not inserted into the
host scene. Runtime snapshots, debugger views and heap persistence need the corresponding runtime secret-projection
policy; hiding a DOM value alone does not establish password confidentiality.

## Qualification

Focused tests use analytical geometry fixtures and injected deterministic services. They are not native WinUI
captures. Browser font shaping, IME, assistive technology, GPU hardware and platform integration are independently
qualified by their corresponding harnesses. The pinned existing native oracle is Windows App SDK 1.8.260921001;
new analytical fixtures must not be described as new native oracle output.

Run the example with `node packages/winui-controls/examples/layout-input.mjs` after package composition. The benchmark
is `node packages/winui-controls/bench/layout.mjs 10000`; it reports cold/warm median/p95/p99 and a retained-memory
proxy explicitly distinguished from total allocations. Validation is deferred until the complete assigned scope
has been integrated, per the project request.
# Synchronous language adapters and worker feedback

`registerLayoutAdapters(registry)` installs `Measure`, `Arrange`, invalidation,
focus, pointer capture, scrolling and typed input methods on the shared UI member
registry. It also installs `registerInputAdapters`; hosts must register it once.

The managed runtime uses `createManagedLayoutServices(context, options)` from
`runtime/ui/layout-services.js`. It runs the same `LayoutEngine` as the browser.
An explicitly measured detached subtree is collected without a heap-wide scan.
Custom `MeasureOverride` and `ArrangeOverride` execute on the original managed
receiver, including calls to the base override. Returned arrange sizes become
`RenderSize` and `ActualWidth`/`ActualHeight` synchronously.

Options accept `measureProvider`, `measureText`, `getRoot`, `getViewport`,
`resolveChildren`, `itemGenerator` and `notifyHost`. A browser worker can inject
`createCanvasMeasureProvider(new OffscreenCanvas(1, 1))` for real whole-run text
widths. This provider supplies layout measurement; text cluster geometry still
requires the rendering text service. A headless process without a real text
measurement provider reports `SFLAYOUT003` when a nonempty text run must be
measured. `UpdateLayout` requires an explicit root viewport, a previous arrange
slot, or current browser feedback; it does not invent a window size.

Managed presentation commands use `{op:'layout', id, method, args}`. The retained
host bounds and copies their data, synchronizes visuals, and applies them before
publishing geometry. `options.onLayoutSnapshot(snapshot)` receives version 1
snapshots with a separate `revision`, root-DIP rectangles, affine transforms,
clip ancestry and desired/render sizes. It runs for transient composition frames
as well as ordinary layout. Forward it to `services.layout.updateFeedback`.
Existing `onLayout` size notifications remain available and include `rect` and
`layout` records. No DOM object, scene property bag or password value is present
in the geometry snapshot.

`serializeRoutedEvent` strips functions and rejects host objects, accessors,
cycles and oversized payloads. `hydratePointerEvent` recreates coordinate helpers
only at the receiving boundary. Pointer samples retain pressure and tilt,
and the final coalesced sample always matches `GetCurrentPoint`. `PointerPoint`
uses typed `Point`, `Rect`, pointer device enum and unsigned timestamp fields.
The public intermediate-point signature is `IList<PointerPoint>`; its managed
representation is a typed array with bounded list/index/enumerator adapters.

Browser timestamps are microseconds from the browser's monotonic time origin,
not Windows system uptime. Browser input does not expose hardware scan codes,
digitizer touch confidence, or an input frame identifier; those fields use zero
or false unless supplied by an explicit native input adapter. Keyboard DOM
codes are never passed as numeric scan codes.

Manipulation inertia uses finite analytical deceleration, honors requested
displacement/rotation/expansion or deceleration, and schedules on the shared
frame scheduler. Cancellation, `Complete`, unload and disposal stop pending
frames. The curve is the documented SharpForge browser policy; Windows gesture
recognizer curve equivalence needs native reference qualification.

Ordinary routed subscriptions and `AddHandler` subscriptions must use one
`RoutedEventRouter.addHandler` entry per delegate to preserve registration order.
Callbacks receive `(targetId, sharedArgs)`. The optional `onTarget` callback runs
after that target's subscriptions; `onDispatch` runs once after the route.
Worker hosts enqueue a single route action and dispatch its handlers
synchronously so `Handled` is visible to later callbacks.
