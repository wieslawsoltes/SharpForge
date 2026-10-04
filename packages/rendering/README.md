# @sharpforge/rendering

Application-owned retained drawing services for SharpForge. The package registers no global mutable state and accepts platform resources through explicit owners.

## Resource ownership

`ResourceTable` rejects stale, foreign and mistyped handles, retains mutable resource versions and delays disposal until the final GPU submission completes. `DeltaUpload` keeps bounded typed storage and uploads only changed aligned ranges.

## Drawing lists

`DrawingContext` records shape, image, text and layer commands in DIP coordinates. `DisplayList` seals immutable snapshots, validates its versioned wire envelope, replays through an injected adapter and diffs retained element versions. Opaque platform objects require resource handles before serialization.

## Retained delegates and transforms

`RenderDelegateRegistry` resolves contributions through declared base types. `DisplayListTreeBuilder` preserves content through placement changes and reports unsupported visuals. Released rectangles, elliptical radii, stroke-only shapes and line commands lower into the same drawing list. Affine helpers define composition order and singular-inverse handling.

## Brushes and images

Solid, linear and radial brushes share explicit color, opacity, transform, interpolation and spread rules. `ImageCache` owns decoded images through cancellation and eviction. `WriteableBitmap` snapshots its exact pixel storage and publishes invalidation. Image fitting and nine-grid placement preserve the requested source rectangle and alignment.

## Path geometry

`parsePath` normalizes relative and absolute SVG-style commands, arcs and smooth controls into immutable geometry. Geometry bounds include transformed curve extrema. Flattening uses target-space error tolerance; fill hit testing preserves winding rules and rejects malformed or cyclic descriptors.

## Fills, strokes and painted bounds

Scanbeam tessellation preserves holes and self-intersections. Strokes preserve dash seams, cap dots, joins and explicit work/vertex budgets. Painted bounds include transforms, stroke extent, glyph overhang and conservative shadow/effect expansion.

## Composition state

`CompositionObject` and `CompositionPropertySet` keep native state under an explicit application owner. Typed getters distinguish missing values and type mismatches; quotas, immutable inputs, animated/base precedence, snapshots and disposal are enforced before a visual tree is attached.

## Composition brushes and effects

Retained brush descriptors preserve owned color stops, interpolation space, masks, surfaces and effect sources. The supported effect subset evaluates premultiplied RGBA, scales blur in DIPs at the supplied DPR and rejects unsupported nodes, invalid graphs and resource cycles. Scene lighting and animatable effect-node properties return explicit unsupported diagnostics.

## Typed drawing resources

`DrawingModel` and `DrawingCollection` retain explicit native state and snapshots. Resource descriptors materialize according to the declared CLR type; Point, Size, Rect and Matrix cross value boundaries as flat typed fields, while scene geometry and brushes retain their property descriptors. Browser system backdrops report their approximation policy.

## Text layout services

`TextLayoutService` caches actual provider results and shares them with measurement and drawing. The browser provider retains shaped native runs with explicit opaque glyph access. Cluster maps drive caret, hit testing and selection; rich spans, trimming and ink bounds remain separate from raster policy. Numeric portable shaping is supplied by a separate provider.

## Control drawing delegates

Resolved control templates draw through ordinary shape, border and text delegates. Measurement and drawing share actual text results. Placement/clip changes retain item contents, native input remains a declared host capability, and capture validates cross-session resources and limits. High-contrast colors come from the host system-color resolver.

## Visual and shape models

Visual collections enforce ownership, parent identity and cycle/depth limits. Typed shapes, clips, dash collections and drop-shadow descriptors preserve snapshots and invalidate owned content. Transforms are in DIPs; the 2D rendering boundary reports unsupported 3D transforms explicitly.

## Typed animation values

`prepareValueAnimation` and `sampleValueAnimation` implement typed interpolation and discrete keyframes. Easing bounds and complete property-path validation fail before mutation. `buildTimelineDefinition` accepts explicit adapters, including endpoint-presence checks for omitted values.

## Composition animation definitions

Keyframe definitions capture values and validated easing plans. Expressions read only supplied parameters and documented typed members through a bounded interpreter. Definitions, groups, implicit collections and batches have explicit owner and snapshot contracts.

## Shared clock

The framework continues to export `AnimationClock` through its existing entry point. It imports typed samplers from this package and is injected into composition; rendering never imports the framework. The trace fixture states its sample tolerance and covers deterministic timeline behavior.

## Compositor playback

`Compositor` builds retained display lists and layer handles, avoiding geometry re-encoding for placement-only changes. Controllers and expressions run on the injected shared clock. Public stop policies remain distinct from internal transient-base restoration. Collection wrappers retain newly added managed children and release removed items through their existing mutation receiver.

## Drawing contracts and native adapters

Registration preserves released numeric identities and exposes typed geometry, brush, transform, bitmap and Canvas contracts. CLR structs materialize flat fields; DependencyObject defaults retain Default precedence and stable collection identity. Canvas sessions snapshot their executable command state. Custom brush connection callbacks occur only during live ownership changes, with silent GC/restore bookkeeping.

## Validation

Focused cases are authored. The publication manifest records the exact previously tested selection, subsequent repairs and any unrun new fixtures. Required core is pending on this exact branch tree. Browser pixels, native WinUI comparisons and physical GPU qualification are separate gates.
