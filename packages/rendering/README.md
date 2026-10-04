# @sharpforge/rendering

Application-owned retained drawing services for SharpForge. The package registers no global mutable state and accepts platform resources through explicit owners.

## Resource ownership

`ResourceTable` rejects stale, foreign and mistyped handles, retains mutable resource versions and delays disposal until the final GPU submission completes. `DeltaUpload` keeps bounded typed storage and uploads only changed aligned ranges.

## Composition state

`CompositionObject` and `CompositionPropertySet` keep native state under an explicit application owner. Typed getters distinguish missing values and type mismatches; quotas, immutable inputs, animated/base precedence, snapshots and disposal are enforced before a visual tree is attached.

## Composition brushes and effects

Retained brush descriptors preserve owned color stops, interpolation space, masks, surfaces and effect sources. The supported effect subset evaluates premultiplied RGBA, scales blur in DIPs at the supplied DPR and rejects unsupported nodes, invalid graphs and resource cycles. Scene lighting and animatable effect-node properties return explicit unsupported diagnostics.

## Drawing lists

`DrawingContext` records shape, image, text and layer commands in DIP coordinates. `DisplayList` seals immutable snapshots, validates its versioned wire envelope, replays through an injected adapter and diffs retained element versions. Opaque platform objects require resource handles before serialization.

## Retained delegates and transforms

`RenderDelegateRegistry` resolves contributions through declared base types. `DisplayListTreeBuilder` preserves content through placement changes and reports unsupported visuals. Released rectangles, elliptical radii, stroke-only shapes and line commands lower into the same drawing list. Affine helpers define composition order and singular-inverse handling.

## Path geometry

`parsePath` normalizes relative and absolute SVG-style commands, arcs and smooth controls into immutable geometry. Geometry bounds include transformed curve extrema. Flattening uses target-space error tolerance; fill hit testing preserves winding rules and rejects malformed or cyclic descriptors.

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

## Element previews and transient transitions

`ElementCompositionPreview` keeps visual state relative to the arranged element and owns explicit hand-in/hand-out leases. Theme and implicit coordinators use stable owner identities, obey reduced motion and restore the underlying base on completion/cancellation. They reuse the compositor clock and do not replace managed local-value slots.

## Connected navigation

`ConnectedAnimationService` owns at most 32 prepared captures and releases each on completion, cancellation or expiry. Navigation transitions use destination layout and reduced-motion policy; capture and overlay services are explicit requirements, and unavailable retained captures fail clearly.

## Composition contract and adapter registration

`registerCompositionContracts` adds the typed surface through the caller’s reserved registry; `ensureNumericsContracts` preserves existing value definitions. `registerCompositionAdapters` accepts the shared native/managed context. TryGet methods use actual out references, and dash CopyTo/GetMany use managed array hooks so conversion and rewind notifications remain observable. No global framework registry is changed at package import.

## Brushes and images

Solid, linear and radial brushes share explicit color, opacity, transform, interpolation and spread rules. `ImageCache` owns decoded images through cancellation and eviction. `WriteableBitmap` snapshots its exact pixel storage and publishes invalidation. Image fitting and nine-grid placement preserve the requested source rectangle and alignment.

## Fills, strokes and painted bounds

Scanbeam tessellation preserves holes and self-intersections. Strokes preserve dash seams, cap dots, joins and explicit work/vertex budgets. Painted bounds include transforms, stroke extent, glyph overhang and conservative shadow/effect expansion.

## Typed drawing resources

`DrawingModel` and `DrawingCollection` retain explicit native state and snapshots. Resource descriptors materialize according to the declared CLR type; Point, Size, Rect and Matrix cross value boundaries as flat typed fields, while scene geometry and brushes retain their property descriptors. Browser system backdrops report their approximation policy.

## Composition graph transport

`serializeCompositionGraph` emits only bounded data and explicit object identities. `applyCompositionGraph` checks kinds, property types, ownership, roots, cycles and effect sources before committing. It preserves existing object/content identities on placement changes and transports geometry, decoded images and stroke dash collections without executable callbacks or host classes.

## Independent host timelines

`CompositionTransport` and `CompositionTransportHost` install definitions and native visual graphs in an explicit application session. Host frames use an injected shared animation clock and return completion identities, avoiding per-frame managed messages. Independent XAML timelines accept only supported render properties; dependent layout properties stay with managed execution. Snapshot, pause, stop, binding removal and disposal preserve ownership and restore transient base values when requested.

## Application composition services

`createCompositionServices` owns one default compositor and connects preview, implicit, theme, connected and navigation services through explicit host callbacks. Additional compositors use weak bookkeeping and do not become permanent managed roots. Host environment changes cancel convenience motion while preserving reusable service instances; app-started storyboards keep their own policy. Paint-brush transitions bind native brush descriptors and clear those bindings when complete.

## Validation

The publication manifest lists authored fixtures and the prior completed-scope evidence separately. Repairs and newly authored cases await the consolidated rerun; required core is pending on this exact branch tree. Browser pixels, native WinUI comparisons and physical GPU qualification remain separate gates.
